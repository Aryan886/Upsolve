#!/usr/bin/env python3
"""Extract a release without accepting paths or links outside its directory."""

import os
import posixpath
import shutil
import sys
import tarfile


def valid_path(name):
    if not name or name.startswith("/") or "\\" in name:
        raise ValueError("Release contains an absolute or invalid path")
    parts = name.rstrip("/").split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("Release contains a path traversal")
    return name.rstrip("/")


def extract(archive, destination):
    os.makedirs(destination, mode=0o755, exist_ok=False)
    links = []
    hard_links = []
    seen = set()
    with tarfile.open(archive, "r:gz") as source:
        members = source.getmembers()
        if sum(member.size for member in members if member.isfile()) > 1024 * 1024 * 1024:
            raise ValueError("Release expands beyond the one-gigabyte limit")
        for member in members:
            name = valid_path(member.name)
            if name in seen:
                raise ValueError("Release contains duplicate paths")
            seen.add(name)
            target = os.path.join(destination, *name.split("/"))
            parent = os.path.dirname(target)
            os.makedirs(parent, mode=0o755, exist_ok=True)
            if member.isdir():
                os.makedirs(target, mode=0o755, exist_ok=True)
            elif member.isfile():
                with source.extractfile(member) as contents:
                    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o755 if member.mode & 0o111 else 0o644)
                    with os.fdopen(descriptor, "wb") as output:
                        shutil.copyfileobj(contents, output)
            elif member.issym():
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), member.linkname))
                if member.linkname.startswith("/") or resolved == ".." or resolved.startswith("../") or "\\" in member.linkname:
                    raise ValueError("Release contains a link outside its directory")
                links.append((target, member.linkname))
            elif member.islnk():
                link_name = valid_path(member.linkname)
                hard_links.append((target, os.path.join(destination, *link_name.split("/"))))
            else:
                raise ValueError(f"Release contains an unsupported file type: {member.name} ({member.type!r})")
    for target, link in hard_links:
        if not os.path.isfile(link) or os.path.islink(link):
            raise ValueError("Release hard link does not point to an internal regular file")
        os.link(link, target)
    for target, link in links:
        os.symlink(link, target)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract-release.py ARCHIVE DESTINATION")
    extract(sys.argv[1], sys.argv[2])

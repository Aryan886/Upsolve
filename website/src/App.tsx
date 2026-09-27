import { useState } from "react";
import { FeedPage } from "./pages/FeedPage";
import { MistakesPage } from "./pages/MistakesPage";
import { SearchPage } from "./pages/SearchPage";

type Page = "feed" | "mistakes" | "patterns" | "snippets" | "editorial";

const pages: { id: Page; label: string }[] = [
  { id: "feed", label: "Diary" },
  { id: "mistakes", label: "Mistakes" },
  { id: "patterns", label: "Patterns" },
  { id: "snippets", label: "Snippets" },
  { id: "editorial", label: "Editorial" },
];

export default function App() {
  const [page, setPage] = useState<Page>("feed");
  const [revision, setRevision] = useState(0);
  const changed = () => setRevision((value) => value + 1);

  return (
    <div className="wrap">
      <header className="site-title">
        <h1>CP Notes</h1>
        <p>A compact diary for the patterns, mistakes, snippets, and insights worth remembering.</p>
      </header>
      <nav className="tab-nav" aria-label="Main views">
        {pages.map((item) => <button key={item.id} type="button" className={page === item.id ? "active" : ""} aria-current={page === item.id ? "page" : undefined} onClick={() => setPage(item.id)}>{item.label}</button>)}
      </nav>
      <main>
        {page === "feed" && <FeedPage revision={revision} onChanged={changed} />}
        {page === "mistakes" && <MistakesPage revision={revision} onChanged={changed} />}
        {page === "patterns" && <SearchPage type="pattern" revision={revision} onChanged={changed} />}
        {page === "snippets" && <SearchPage type="snippet" revision={revision} onChanged={changed} />}
        {page === "editorial" && <SearchPage type="editorial" revision={revision} onChanged={changed} />}
      </main>
      <footer>Local-only competitive programming notes. Capture from the Chrome extension; review here.</footer>
    </div>
  );
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { readInvitation } from "./App";
import "./styles.css";

const initialInvitation = readInvitation();
const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(<StrictMode><App initialInvitation={initialInvitation} /></StrictMode>);

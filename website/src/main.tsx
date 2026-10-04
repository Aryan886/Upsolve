import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { readSignupLink } from "./App";
import "./styles.css";

const initialSignup = readSignupLink();
const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(<StrictMode><App initialSignup={initialSignup} /></StrictMode>);

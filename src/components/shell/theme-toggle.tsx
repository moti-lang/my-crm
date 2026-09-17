"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, SunMoon } from "lucide-react";
import { Chip } from "@/components/ui/badge";

type Theme = "light" | "dark" | "system";

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("theme") as Theme | null;
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);
  function choose(t: Theme) {
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", t);
    } catch {}
    apply(t);
  }
  return (
    <div className="flex gap-2">
      <Chip active={theme === "light"} onClick={() => choose("light")}>
        <Sun className="h-4 w-4" /> בהיר
      </Chip>
      <Chip active={theme === "dark"} onClick={() => choose("dark")}>
        <Moon className="h-4 w-4" /> כהה
      </Chip>
      <Chip active={theme === "system"} onClick={() => choose("system")}>
        <SunMoon className="h-4 w-4" /> לפי המכשיר
      </Chip>
    </div>
  );
}

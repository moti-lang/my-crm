import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      // ה-Service Worker חייב להיטען טרי בכל פעם, אחרת עדכונים לא מגיעים למכשירים מותקנים
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/manifest.webmanifest", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default nextConfig;

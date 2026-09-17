"use client";

import { MessageCircle, Navigation, Phone } from "lucide-react";
import { AnchorButton } from "@/components/ui/button";
import { navLinks, type NavTarget } from "@/lib/geo";
import { telHref, whatsappHref } from "@/lib/phone";

export function NavButtons({ target, size = "md" }: { target: NavTarget; size?: "sm" | "md" }) {
  const links = navLinks(target);
  if (!links) return null;
  return (
    <>
      <AnchorButton href={links.waze} target="_blank" rel="noopener" variant="outline" size={size}>
        <Navigation className="h-4 w-4" /> Waze
      </AnchorButton>
      <AnchorButton href={links.gmaps} target="_blank" rel="noopener" variant="outline" size={size}>
        <Navigation className="h-4 w-4" /> מפות
      </AnchorButton>
    </>
  );
}

export function PhoneButtons({ phone, size = "md", text }: { phone: string | null | undefined; size?: "sm" | "md"; text?: string }) {
  if (!phone) return null;
  return (
    <>
      <AnchorButton href={telHref(phone)} variant="outline" size={size}>
        <Phone className="h-4 w-4" /> התקשר
      </AnchorButton>
      <AnchorButton href={whatsappHref(phone, text)} target="_blank" rel="noopener" variant="outline" size={size}>
        <MessageCircle className="h-4 w-4" /> וואטסאפ
      </AnchorButton>
    </>
  );
}

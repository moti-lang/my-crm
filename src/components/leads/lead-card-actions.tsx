"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, Camera, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { instantToNext, nextToIso, type NextActionValue } from "@/lib/client/lead-form-model";
import { Button, LinkButton } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { NavButtons, PhoneButtons } from "./lead-actions";
import { NextActionPicker } from "./next-action-picker";
import { TouchForm } from "./touch-form";
import { SawClosedButton } from "@/components/route/saw-closed-button";

export interface CardLead {
  id: string;
  name: string | null;
  descriptor: string | null;
  phone: string | null;
  status: string;
  heat: string;
  contactName: string | null;
  area: string | null;
  addressNote: string | null;
  lat: number | null;
  lng: number | null;
  nextActionAt: Date | null;
  nextActionType: string | null;
  nextActionNote: string | null;
  nextActionIsApproximate: boolean;
  openTasks: number;
}

export function LeadCardActions({ lead }: { lead: CardLead }) {
  const [touchOpen, setTouchOpen] = useState(false);
  const [nextOpen, setNextOpen] = useState(false);
  return (
    <>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <PhoneButtons phone={lead.phone} text={`שלום${lead.contactName ? ` ${lead.contactName}` : ""}, `} />
        <NavButtons target={lead} />
        <Button variant="outline" onClick={() => setNextOpen(true)}>
          <CalendarPlus className="h-4 w-4" /> קבע מעקב
        </Button>
        <Button onClick={() => setTouchOpen(true)}>
          <MessageSquarePlus className="h-4 w-4" /> הוסף מגע
        </Button>
        <SawClosedButton leadId={lead.id} size="md" />
        <LinkButton href={`/leads/${lead.id}/edit`} variant="ghost">
          <Pencil className="h-4 w-4" /> עריכה
        </LinkButton>
      </div>
      {touchOpen && <TouchForm lead={lead} open={touchOpen} onClose={() => setTouchOpen(false)} />}
      <NextActionSheet lead={lead} open={nextOpen} onClose={() => setNextOpen(false)} />
    </>
  );
}

export function NextActionSheet({ lead, open, onClose }: { lead: CardLead; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState<NextActionValue>(() => instantToNext(lead.nextActionAt, lead.nextActionType, lead.nextActionNote, lead.nextActionIsApproximate));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/api/leads/${lead.id}`, {
        method: "PATCH",
        body: {
          nextActionAt: nextToIso(value),
          nextActionType: value.date ? value.type ?? undefined : null,
          nextActionNote: value.date ? value.note || null : null,
          nextActionIsApproximate: value.date ? value.isApproximate : false,
        },
      });
      toast(value.date ? "המעקב נקבע" : "המעקב בוטל", "success");
      onClose();
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="קבע מעקב"
      footer={
        <Button size="lg" className="w-full" onClick={save} disabled={busy}>
          {busy ? "שומר…" : "שמור"}
        </Button>
      }
    >
      <NextActionPicker value={value} onChange={setValue} hasPhone={Boolean(lead.phone)} />
    </Sheet>
  );
}

/** מקטין תמונה בדפדפן לפני העלאה (עד 1600px, JPEG) */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.82));
}

export function PhotoUploader({ leadId }: { leadId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const blob = await shrink(file);
      const fd = new FormData();
      fd.append("file", blob, "photo.jpg");
      const caption = window.prompt("כיתוב לתמונה (לא חובה): שלט כניסה / חזית / …") ?? "";
      if (caption) fd.append("caption", caption);
      await api(`/api/leads/${leadId}/photos`, { method: "POST", formData: fd });
      toast("התמונה נשמרה", "success");
      router.refresh();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
        <Camera className="h-4 w-4" /> {busy ? "מעלה…" : "צלם / העלה"}
      </Button>
    </>
  );
}

export function DeletePhotoButton({ photoId }: { photoId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  return (
    <button
      type="button"
      className="absolute end-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white"
      aria-label="מחק תמונה"
      onClick={async () => {
        if (!window.confirm("למחוק את התמונה?")) return;
        try {
          await api(`/api/photos/${photoId}`, { method: "DELETE" });
          router.refresh();
        } catch (e) {
          toast(errorMessage(e), "error");
        }
      }}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

export function DeleteLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-danger"
      onClick={async () => {
        if (!window.confirm("למחוק את הליד על כל המגעים והמשימות שלו? אי אפשר לבטל.")) return;
        try {
          await api(`/api/leads/${leadId}`, { method: "DELETE" });
          toast("הליד נמחק", "info");
          router.push("/leads");
          router.refresh();
        } catch (e) {
          toast(errorMessage(e), "error");
        }
      }}
    >
      <Trash2 className="h-4 w-4" /> מחק ליד
    </Button>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-muted-foreground hover:underline">
      {children}
    </Link>
  );
}

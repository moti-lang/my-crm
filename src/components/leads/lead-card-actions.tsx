"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, MessageSquarePlus, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { NavButtons, PhoneButtons } from "./lead-actions";
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

/** פס פעולות: התקשר · וואטסאפ · ניווט · הוסף מגע · ראיתי שסגור */
export function LeadCardActions({ lead }: { lead: CardLead }) {
  const [touchOpen, setTouchOpen] = useState(false);
  return (
    <>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Button onClick={() => setTouchOpen(true)}>
          <MessageSquarePlus className="h-4 w-4" /> הוסף מגע
        </Button>
        <PhoneButtons phone={lead.phone} text={`שלום${lead.contactName ? ` ${lead.contactName}` : ""}, `} />
        <NavButtons target={lead} />
        <SawClosedButton leadId={lead.id} size="md" />
      </div>
      {touchOpen && <TouchForm lead={lead} open={touchOpen} onClose={() => setTouchOpen(false)} />}
    </>
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

/** מחיקת ליד — רק מתפריט משני, עם אישור */
export function DeleteLeadButton({ leadId, asMenuItem }: { leadId: string; asMenuItem?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  async function del() {
    if (!window.confirm("למחוק את הליד על כל המגעים, המשימות והתמונות שלו? אי אפשר לבטל.")) return;
    try {
      await api(`/api/leads/${leadId}`, { method: "DELETE" });
      toast("הליד נמחק", "info");
      router.push("/leads");
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  if (asMenuItem) {
    return (
      <button type="button" onClick={del} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start text-danger hover:bg-danger/10">
        <Trash2 className="h-4 w-4" /> מחק ליד…
      </button>
    );
  }
  return (
    <Button variant="ghost" size="sm" className="text-danger" onClick={del}>
      <Trash2 className="h-4 w-4" /> מחק ליד
    </Button>
  );
}

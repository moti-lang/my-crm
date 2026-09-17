import { getFilterOptions } from "@/lib/leads";
import { claudeConfigured } from "@/lib/parse";
import { PageTitle } from "@/components/ui/card";
import { QuickAdd } from "@/components/leads/quick-add";

export const dynamic = "force-dynamic";
export const metadata = { title: "הוספה מהירה" };

export default async function NewLeadPage() {
  const options = await getFilterOptions();
  return (
    <div>
      <PageTitle sub="פחות מ-20 שניות. שום שדה לא חובה חוץ ממזהה אחד.">הוספה מהירה</PageTitle>
      <QuickAdd areas={options.areas} categories={options.categories} claude={claudeConfigured()} />
    </div>
  );
}

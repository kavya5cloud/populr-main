import { redirect } from "next/navigation";
import { STUDIO_FALLBACK } from "@/lib/studio/unsupported";

// No image provider exists. See lib/studio/unsupported.ts.
export default function Page() {
  redirect(STUDIO_FALLBACK);
}

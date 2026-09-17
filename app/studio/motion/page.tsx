import { redirect } from "next/navigation";
import { STUDIO_FALLBACK } from "@/lib/studio/unsupported";

// Nothing renders motion. See lib/studio/unsupported.ts.
export default function Page() {
  redirect(STUDIO_FALLBACK);
}

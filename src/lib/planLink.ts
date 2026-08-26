// Target path: src/lib/planLink.ts
//
// Shared validation for "plan link" fields (lot_sheets.plan_url). The
// requirement is that a plan link must be a genuine Google Drive (or
// Google Docs/Sheets/Slides, which live under the same Drive backend) URL
// that actually references a specific file or folder — not just any
// https link, and not a bare "drive.google.com" with no id — so that
// every recorded plan can be traced back to a real object in Drive.
//
// Used from:
//   - AttributeTable.tsx's AddPlanLinkControl (client-side, so the user
//     gets instant feedback before hitting Save)
//   - ExportFooter.tsx's save-to-database modal (same reason, for the
//     optional plan link entered when a sheet is first created)
//   - src/app/api/lot-sheets/[id]/route.ts's PATCH handler (server-side,
//     so the rule is actually enforced regardless of what hits the API —
//     the client checks are a UX nicety, not the real gate)

const ALLOWED_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

// Matches a Drive/Docs file or folder id embedded in the path, e.g.
//   /file/d/<id>/view
//   /document/d/<id>/edit
//   /spreadsheets/d/<id>/edit
//   /presentation/d/<id>/edit
//   /drive/folders/<id>
//   /drive/u/0/folders/<id>
const ID_IN_PATH = /\/(?:d|folders)\/([a-zA-Z0-9_-]{10,})/;

// Checks whether a string is a Google Drive/Docs URL that points at an
// actual file or folder id — not just the bare domain, and not some
// unrelated google.com path. Returns false (rather than throwing) for
// anything unparsable as a URL.
export function isTraceableGoogleDriveLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return false;

  if (ID_IN_PATH.test(url.pathname)) return true;

  // Legacy share form: drive.google.com/open?id=<id>
  const idParam = url.searchParams.get("id");
  if (idParam && idParam.length >= 10) return true;

  return false;
}

export const PLAN_LINK_HELP_MESSAGE =
  "Must be a Google Drive link that points to a specific file or folder (e.g. drive.google.com/file/d/…, drive.google.com/drive/folders/…, or docs.google.com/document/d/…) so it can be traced.";
// Target path: src/app/api/auth/me/route.ts
//
// GET -> { user: {...} | null }. Reads the session cookie and returns the
// currently logged-in user's public fields. Sidebar.tsx currently takes
// userName/userEmail as hardcoded props ("Admin User" / "admin@example.com")
// -- point the map page at this endpoint to fetch the real values and pass
// them down instead, e.g.:
//
//   const [me, setMe] = useState<{ username: string; email: string; usertype: string } | null>(null);
//   useEffect(() => {
//     fetch("/api/auth/me").then((r) => r.json()).then((d) => setMe(d.user));
//   }, []);
//   ...
//   <Sidebar userName={me?.username} userEmail={me?.email} ... />

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, verifySession } from "@/lib/auth";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ user: null });

  const session = await verifySession(token);
  if (!session) return NextResponse.json({ user: null });

  return NextResponse.json({
    user: {
      id: session.userId,
      username: session.username,
      email: session.email,
      usertype: session.usertype,
    },
  });
}
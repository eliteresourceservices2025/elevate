import { BookOpenCheck, ClipboardList, GraduationCap, House, LogOut } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

/**
 * The bar across the top of every page. Signed in, it carries the three places a person goes (my training, my record, the quick-reference
 * cards) and Sign out, so nobody has to scroll to leave; signed out (the public check page, the signed-out page) it is just the name and
 * the light / dark choice. "Signed in" here only means a session cookie is present: every page still checks the session itself.
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="site">
      <div>
        <Link href="/" className="brand" aria-label="ELEVATE Learn, home">
          <GraduationCap size={22} aria-hidden="true" />
          <strong>ELEVATE Learn</strong>
        </Link>
        {signedIn ? (
          <nav className="topnav" aria-label="Main">
            <Link href="/">
              <House size={16} aria-hidden="true" /> <span className="nav-label">My training</span>
            </Link>
            <Link href="/record">
              <ClipboardList size={16} aria-hidden="true" /> <span className="nav-label">My record</span>
            </Link>
            <Link href="/cards">
              <BookOpenCheck size={16} aria-hidden="true" /> <span className="nav-label">Quick cards</span>
            </Link>
          </nav>
        ) : null}
        <div className="topright">
          <ThemeToggle />
          {signedIn ? (
            <form method="post" action="/auth/signout">
              <button type="submit" className="signout-top">
                <LogOut size={16} aria-hidden="true" /> <span className="nav-label">Sign out</span>
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </header>
  );
}

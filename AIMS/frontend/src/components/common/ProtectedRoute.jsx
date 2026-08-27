import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getToken } from '../../api/client';
import { landingPathForRole } from '../../api/roles';

/**
 * Guards a portal route.
 *
 * Without a token the visitor is sent to the sign-in screen for the portal
 * they tried to open. With a token belonging to a different portal they are
 * sent to their own landing page instead, so a signed-in student cannot open
 * the admin dashboard by typing the URL.
 *
 * @param {string} portal one of 'admin' | 'faculty' | 'student' | 'parent'
 */
export default function ProtectedRoute({ portal, children }) {
  const { user } = useAuth();
  const location = useLocation();

  // The token is the source of truth: it survives a refresh, and the api
  // client clears it the moment the backend rejects it.
  const token = getToken();

  if (!token || !user) {
    return (
      <Navigate
        to={`/sign-in/${portal}`}
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  if (portal && user.role !== portal) {
    return <Navigate to={landingPathForRole(user.roleId)} replace />;
  }

  /*
   * An account still holding an admin-issued password cannot go anywhere except
   * the screen that replaces it.
   *
   * When an admin admits a student or onboards a teacher, the server generates
   * a password and shows it to the ADMIN. That is fine for handing over and
   * wrong as a standing credential — until the user picks their own, someone
   * else knows how to sign in as them. The backend sets must_change_password on
   * those accounts and clears it the moment the user changes it.
   *
   * The guard lives here rather than in each portal so no portal can forget it.
   */
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return children;
}

/**
 * Guards /change-password, the FORCED first-sign-in screen.
 *
 * THE BUG THIS CLOSES
 * -------------------
 * The route had no guard at all. It rendered for anyone who reached it,
 * including a signed-out visitor, and — the reported case — including someone
 * who had already changed their password minutes earlier.
 *
 * How they reached it is the other half. Changing a password emits an
 * "account" notification, and every "account" notification was given the same
 * destination by notificationService.LINKS: /change-password. So the row
 * announcing that the password HAD been changed linked to the form for
 * changing it, permanently, and could be opened again on every visit to the
 * notification centre. The emitter side is fixed too (authController no longer
 * attaches a link to a change that has already happened), but rows written
 * before that fix still carry it, and a URL anyone can type is not fixed by
 * changing what links to it.
 *
 * THE RULE
 * --------
 * This screen exists to answer exactly one outstanding request: "an
 * administrator issued you a password, replace it". That request is recorded
 * as users.must_change_password. While the flag is set the screen is
 * available; the moment the change succeeds the backend clears it and this
 * sends the user to their own portal instead. One appearance per issuance —
 * and a new issuance by an admin sets the flag again, which makes the screen
 * available again.
 *
 * A routine change is not turned away, only redirected: every portal offers
 * one from its own profile (ChangePasswordDialog), which is where a user who
 * simply wants a new password belongs.
 */
export function ForcedPasswordChangeRoute({ children }) {
  const { user } = useAuth();
  const token = getToken();

  if (!token || !user) return <Navigate to="/sign-in" replace />;

  if (!user.mustChangePassword) {
    return <Navigate to={landingPathForRole(user.roleId)} replace />;
  }

  return children;
}

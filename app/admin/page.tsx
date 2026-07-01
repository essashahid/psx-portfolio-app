import { AdminUsersClient } from "./admin-users-client";
import { AdminWaitlistClient } from "./admin-waitlist-client";
import { AdminFeedbackClient } from "./admin-feedback-client";

export const metadata = { title: "Admin · Users" };

export default function AdminUsersPage() {
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every account on the platform. Create new accounts, reset passwords, suspend or remove access.
        </p>
      </div>
      <AdminUsersClient />
      <AdminFeedbackClient />
      <AdminWaitlistClient />
    </div>
  );
}

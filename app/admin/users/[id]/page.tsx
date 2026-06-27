import { UserDetailClient } from "./user-detail-client";

export const metadata = { title: "Admin · User" };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserDetailClient userId={id} />;
}

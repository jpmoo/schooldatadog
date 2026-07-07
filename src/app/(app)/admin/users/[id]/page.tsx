import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getDistricts } from "@/lib/admin/districts";
import { requireAdmin } from "@/lib/auth/guards";
import { EditUserForm } from "./edit-user-form";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) notFound();

  const [user, districts] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        homeDistrictId: users.homeDistrictId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((r) => r[0]),
    getDistricts(),
  ]);

  if (!user) notFound();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href="/admin/users"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Users
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
          Edit {user.name || user.email}
        </h1>
      </div>

      <EditUserForm
        userId={user.id}
        initial={{
          name: user.name,
          email: user.email,
          role: user.role,
          homeDistrictId: user.homeDistrictId,
        }}
        districts={districts}
        isSelf={user.id === admin.id}
      />
    </div>
  );
}

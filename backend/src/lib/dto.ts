import { pickPrimaryRole } from './roles';

/** Shape the UserProfile contract response from a Prisma user (with roles + company included). */
export function toUserProfile(u: {
  id: string;
  fullName: string;
  email: string;
  contactNumber: string;
  address: string;
  pinCode: string;
  distanceKm: unknown;
  status: string;
  emailVerified: boolean;
  companyId: string;
  createdAt: Date;
  updatedAt: Date;
  company?: { name: string } | null;
  roles?: { role: { name: string } }[];
}) {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    contactNumber: u.contactNumber,
    address: u.address,
    pinCode: u.pinCode,
    distanceKm: u.distanceKm != null ? Number(u.distanceKm) : null,
    status: u.status,
    emailVerified: u.emailVerified,
    companyId: u.companyId,
    companyName: u.company?.name ?? '',
    role: pickPrimaryRole((u.roles ?? []).map((r) => r.role.name)),
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

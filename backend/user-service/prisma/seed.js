const prisma = require("../src/config/database");
const { hashPassword } = require("../src/utils/password.util");

const SEED_USERS = [
  {
    email: "demo.user@user.local",
    username: "demo_user",
    firstName: "Demo",
    lastName: "Customer",
    phoneNumber: "+15550100",
    gender: "prefer_not_to_say",
    role: "USER",
    password: "DemoPass@1234",
    city: "Addis Ababa",
    country: "Ethiopia",
    bio: "Standalone development user for Phase 2 profile APIs.",
  },
  {
    email: "profile.editor@user.local",
    username: "profile_editor",
    firstName: "Priya",
    lastName: "Editor",
    phoneNumber: "+15550101",
    gender: "female",
    role: "USER",
    password: "ProfilePass@1234",
    city: "Nairobi",
    country: "Kenya",
    bio: "Used to exercise profile update flows.",
  },
];

async function seed() {
  for (const entry of SEED_USERS) {
    const passwordHash = await hashPassword(entry.password);

    const user = await prisma.userProfile.upsert({
      where: { email: entry.email },
      update: { passwordHash },
      create: {
        email: entry.email,
        username: entry.username,
        firstName: entry.firstName,
        lastName: entry.lastName,
        phoneNumber: entry.phoneNumber,
        dateOfBirth: new Date("1995-06-15"),
        gender: entry.gender,
        role: entry.role,
        passwordHash,
        city: entry.city,
        country: entry.country,
        bio: entry.bio,
      },
    });

    console.log(`seeded: ${user.role.padEnd(12)} ${user.email}`);
  }
}

seed()
  .then(() => {
    console.log("seed complete");
    return prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("seed failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });

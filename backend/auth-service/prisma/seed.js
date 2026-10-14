const prisma = require("../src/config/database");
const { hashPassword } = require("../src/utils/password.util");

const SEED_USERS = [
  {
    email: "admin@meridianbank.test",
    username: "admin",
    firstName: "Ada",
    lastName: "Administrator",
    role: "ADMIN",
    password: "Admin@1234",
    securityQuestion: "What city were you born in?",
    securityAnswer: "addis ababa",
  },
  {
    email: "officer.kyc@meridianbank.test",
    username: "kyc_officer",
    firstName: "Kofi",
    lastName: "Verification",
    role: "VERIFICATION_OFFICER",
    password: "Officer@1234",
    securityQuestion: "What was the name of your first school?",
    securityAnswer: "st. george",
  },
  {
    email: "officer.finance@meridianbank.test",
    username: "finance_officer",
    firstName: "Marta",
    lastName: "Finance",
    role: "FINANCIAL_OFFICER",
    password: "Officer@1234",
    securityQuestion: "What was your childhood nickname?",
    securityAnswer: "marty",
  },
  {
    email: "demo@meridianbank.test",
    username: "demo_user",
    firstName: "Daniel",
    lastName: "Customer",
    role: "USER",
    password: "Demo@1234",
    securityQuestion: "What is your mother's maiden name?",
    securityAnswer: "bekele",
  },
];

async function seed() {
  for (const entry of SEED_USERS) {
    const [passwordHash, securityAnswerHash] = await Promise.all([
      hashPassword(entry.password),
      hashPassword(entry.securityAnswer.toLowerCase()),
    ]);

    const user = await prisma.user.upsert({
      where: { email: entry.email },
      update: {},
      create: {
        email: entry.email,
        username: entry.username,
        firstName: entry.firstName,
        lastName: entry.lastName,
        dateOfBirth: new Date("1990-01-01"),
        gender: "prefer_not_to_say",
        phoneNumber: "+251900000000",
        passwordHash,
        securityQuestion: entry.securityQuestion,
        securityAnswerHash,
        acceptedTerms: true,
        acceptedTermsAt: new Date(),
        role: entry.role,
        isEmailVerified: true,
      },
    });

    console.log(`seeded: ${user.role.padEnd(20)} ${user.email}`);
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

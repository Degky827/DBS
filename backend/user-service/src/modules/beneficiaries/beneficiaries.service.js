const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");

const maskAccountNumber = (accountNumber) => {
  const digits = String(accountNumber);
  if (digits.length <= 4) return "*".repeat(digits.length);
  return `${"*".repeat(Math.max(digits.length - 4, 2))}${digits.slice(-4)}`;
};

const formatBeneficiary = (beneficiary) => ({
  id: beneficiary.id,
  name: beneficiary.name,
  nickname: beneficiary.nickname,
  accountNumber: maskAccountNumber(beneficiary.accountNumber),
  bankName: beneficiary.bankName,
  bankCode: beneficiary.bankCode,
  destinationWalletId: beneficiary.destinationWalletId,
  isFavorite: beneficiary.isFavorite,
  createdAt: beneficiary.createdAt,
  updatedAt: beneficiary.updatedAt,
});

const assertDestinationWallet = async (userId, destinationWalletId) => {
  if (!destinationWalletId) return;
  const wallet = await prisma.wallet.findUnique({
    where: { id: destinationWalletId },
    select: { id: true, userId: true, isActive: true },
  });
  if (!wallet) {
    throw ApiError.notFound("Destination wallet not found", "WALLET_NOT_FOUND");
  }
  if (wallet.userId === userId) {
    throw ApiError.badRequest("A beneficiary cannot be your own wallet", "SELF_BENEFICIARY");
  }
  if (!wallet.isActive) {
    throw ApiError.conflict("Destination wallet is inactive", "WALLET_INACTIVE");
  }
};

const listBeneficiaries = async (userId) => {
  const beneficiaries = await prisma.beneficiary.findMany({
    where: { userId },
    orderBy: [{ isFavorite: "desc" }, { createdAt: "desc" }],
  });
  return { beneficiaries: beneficiaries.map(formatBeneficiary) };
};

const createBeneficiary = async (userId, input) => {
  await assertDestinationWallet(userId, input.destinationWalletId);

  try {
    const beneficiary = await prisma.beneficiary.create({
      data: {
        userId,
        name: input.name,
        nickname: input.nickname || null,
        accountNumber: input.accountNumber,
        bankName: input.bankName || "Meridian Bank",
        bankCode: input.bankCode || null,
        destinationWalletId: input.destinationWalletId || null,
        isFavorite: input.isFavorite === true,
      },
    });
    audit("BENEFICIARY_CREATED", { userId, beneficiaryId: beneficiary.id });
    return { beneficiary: formatBeneficiary(beneficiary) };
  } catch (error) {
    if (error.code === "P2002") {
      throw ApiError.conflict(
        "A beneficiary with this account number already exists",
        "BENEFICIARY_EXISTS"
      );
    }
    throw error;
  }
};

const getOwnedBeneficiary = async (userId, beneficiaryId) => {
  const beneficiary = await prisma.beneficiary.findFirst({
    where: { id: beneficiaryId, userId },
  });
  if (!beneficiary) {
    throw ApiError.notFound("Beneficiary not found", "BENEFICIARY_NOT_FOUND");
  }
  return beneficiary;
};

const updateBeneficiary = async (userId, beneficiaryId, input) => {
  const existing = await getOwnedBeneficiary(userId, beneficiaryId);
  if (
    input.destinationWalletId !== undefined &&
    input.destinationWalletId !== existing.destinationWalletId
  ) {
    await assertDestinationWallet(userId, input.destinationWalletId);
  }

  try {
    const beneficiary = await prisma.beneficiary.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.nickname !== undefined ? { nickname: input.nickname || null } : {}),
        ...(input.accountNumber !== undefined ? { accountNumber: input.accountNumber } : {}),
        ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
        ...(input.bankCode !== undefined ? { bankCode: input.bankCode || null } : {}),
        ...(input.destinationWalletId !== undefined
          ? { destinationWalletId: input.destinationWalletId || null }
          : {}),
        ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}),
      },
    });
    audit("BENEFICIARY_UPDATED", { userId, beneficiaryId: beneficiary.id });
    return { beneficiary: formatBeneficiary(beneficiary) };
  } catch (error) {
    if (error.code === "P2002") {
      throw ApiError.conflict(
        "A beneficiary with this account number already exists",
        "BENEFICIARY_EXISTS"
      );
    }
    throw error;
  }
};

const deleteBeneficiary = async (userId, beneficiaryId) => {
  const existing = await getOwnedBeneficiary(userId, beneficiaryId);
  await prisma.beneficiary.delete({ where: { id: existing.id } });
  audit("BENEFICIARY_DELETED", { userId, beneficiaryId: existing.id });
  return { id: existing.id };
};

module.exports = {
  listBeneficiaries,
  createBeneficiary,
  updateBeneficiary,
  deleteBeneficiary,
  formatBeneficiary,
};

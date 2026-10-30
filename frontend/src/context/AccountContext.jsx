/* eslint-disable react-refresh/only-export-components -- this module shares the account provider with its consumer hook and derived helpers */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSelector } from "react-redux";
import { getMyProfile } from "../services/userService";
import { getMyWallet } from "../services/walletService";
import { getKycStatus } from "../services/kycService";
import { normalizeApiError } from "../utils/apiError";
import { isUninitializedDate } from "../utils/format";

const AccountContext = createContext(null);

const INITIAL_STATE = {
  profile: null,
  wallet: null,
  kyc: null,
  loading: true,
  profileError: "",
  walletError: "",
  kycUnavailable: false,
};

export const isProfileComplete = (profile) =>
  Boolean(
    profile?.firstName &&
      profile?.lastName &&
      profile?.phoneNumber &&
      profile?.dateOfBirth &&
      !isUninitializedDate(profile.dateOfBirth) &&
      profile?.addressLine1 &&
      profile?.city &&
      profile?.country
  );

const kycNeedsAttention = (status) =>
  status === "NEEDS_RESUBMISSION" || status === "REJECTED";

const buildNotices = (state, authUser) => {
  if (state.loading) return [];
  const notices = [];

  if (kycNeedsAttention(state.kyc?.status)) {
    notices.push({
      id: "kyc-attention",
      tone: "warning",
      title: "Identity verification needs attention",
      description:
        state.kyc.status === "REJECTED"
          ? "Review the decision and, if you are eligible, start a new verification."
          : "Update your identity document and finish the verification steps.",
      to: "/kyc/status",
      actionLabel: "Review status",
      actionable: true,
    });
  } else if (!state.kycUnavailable && !state.kyc) {
    notices.push({
      id: "kyc-start",
      tone: "warning",
      title: "Verify your identity",
      description: "Complete identity verification to unlock transfers and payments.",
      to: "/kyc",
      actionLabel: "Start verification",
      actionable: true,
    });
  } else if (state.kyc?.status === "IN_PROGRESS") {
    notices.push({
      id: "kyc-progress",
      tone: "info",
      title: "Verification in progress",
      description: "Complete the secure identity session to continue.",
      to: "/kyc/verify",
      actionLabel: "Continue",
      actionable: true,
    });
  } else if (state.kyc?.status === "PENDING_REVIEW") {
    notices.push({
      id: "kyc-review",
      tone: "info",
      title: "Verification under review",
      description: "Your checks are complete. A verification officer will record the decision.",
      to: "/kyc/status",
      actionLabel: "View status",
      actionable: false,
    });
  }

  if (state.profile && !isProfileComplete(state.profile)) {
    notices.push({
      id: "profile-incomplete",
      tone: "info",
      title: "Complete your profile",
      description: "Add your contact details and address to finish setting up your account.",
      to: "/profile/edit",
      actionLabel: "Edit profile",
      actionable: true,
    });
  }

  if (!state.wallet && !state.walletError) {
    notices.push({
      id: "wallet-missing",
      tone: "info",
      title: "Create your ETB wallet",
      description: "Set up a wallet to hold your balance and make internal transfers.",
      to: "/wallet",
      actionLabel: "Open wallet",
      actionable: true,
    });
  }

  if (authUser?.isEmailVerified === false) {
    notices.push({
      id: "email-unverified",
      tone: "warning",
      title: "Email not verified",
      description: "Confirm your email address with the six-digit code sent to your inbox.",
      to: "/verify-email",
      actionLabel: "Verify email",
      actionable: true,
    });
  }

  return notices;
};

export function AccountProvider({ children }) {
  const authUser = useSelector((state) => state.auth.user);
  const [state, setState] = useState(INITIAL_STATE);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    if (!silent) {
      setState((previous) => ({ ...previous, loading: true, profileError: "" }));
    }

    const [profileResult, walletResult, kycResult] = await Promise.allSettled([
      getMyProfile(),
      getMyWallet(),
      getKycStatus(),
    ]);

    if (!mountedRef.current || requestRef.current !== requestId) return;

    setState((previous) => {
      const next = { ...previous, loading: false };

      if (profileResult.status === "fulfilled") {
        next.profile = profileResult.value;
        next.profileError = "";
      } else if (profileResult.reason?.response?.status !== 401) {
        next.profileError =
          normalizeApiError(profileResult.reason).message ||
          "Unable to load your profile right now.";
      }

      if (walletResult.status === "fulfilled") {
        next.wallet = walletResult.value;
        next.walletError = "";
      } else if (walletResult.reason?.response?.status === 404) {
        next.wallet = null;
        next.walletError = "";
      } else if (walletResult.reason?.response?.status !== 401) {
        next.walletError =
          normalizeApiError(walletResult.reason).message ||
          "Unable to load your wallet right now.";
      }

      if (kycResult.status === "fulfilled") {
        next.kyc = kycResult.value;
        next.kycUnavailable = false;
      } else if (kycResult.reason?.response?.status === 404) {
        next.kyc = null;
        next.kycUnavailable = false;
      } else if (kycResult.reason?.response?.status !== 401) {
        next.kycUnavailable = true;
      }

      return next;
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const load = async () => {
      await refresh({ silent: true });
    };
    load();
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, [refresh]);

  const notices = useMemo(() => buildNotices(state, authUser), [state, authUser]);

  const value = useMemo(
    () => ({
      ...state,
      notices,
      actionableNoticeCount: notices.filter((notice) => notice.actionable).length,
      refresh,
    }),
    [state, notices, refresh]
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error("useAccount must be used inside AccountProvider");
  }
  return context;
}

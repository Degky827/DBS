import { kycApi } from "./api";

// Customer endpoints
export const createKycSubmission = async () => {
  // The backend schema is z.object({}).strict() — no body fields allowed.
  const { data } = await kycApi.post("/submissions", {});
  return data.data;
};

export const getKycStatus = async () => {
  const { data } = await kycApi.get("/status");
  return data.data;
};

export const getKycDocument = async (documentId) => {
  const { data } = await kycApi.get(`/documents/${documentId}`);
  return data.data;
};

export const getKycDocumentContent = async (documentId) => {
  const response = await kycApi.get(`/documents/${documentId}/content`, {
    responseType: "blob",
  });

  const blob = response.data;
  const mimeType = response.headers["content-type"] || blob.type || "image/png";

  return {
    url: URL.createObjectURL(blob),
    mimeType,
  };
};

export const uploadKycDocument = async ({ submissionId, documentType, side, file }) => {
  const formData = new FormData();
  formData.append("document", file);
  formData.append("documentType", documentType);
  if (side) formData.append("side", side);

  const { data } = await kycApi.post(`/submissions/${submissionId}/documents`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return data.data;
};

export const correctKycDocumentFields = async (documentId, fields) => {
  const { data } = await kycApi.patch(`/documents/${documentId}/corrections`, { fields });
  return data.data;
};

export const deleteKycDocument = async (documentId) => {
  const { data } = await kycApi.delete(`/documents/${documentId}`);
  return data.data;
};

export const compareKycProfile = async (submissionId) => {
  const { data } = await kycApi.post(`/submissions/${submissionId}/compare`);
  return data.data;
};

export const startVerificationSession = async (submissionId) => {
  const { data } = await kycApi.post(`/submissions/${submissionId}/verification-session`);
  return data.data;
};

// Officer endpoints (server enforces ADMIN / OFFICER / VERIFICATION_OFFICER)
export const getOfficerReviews = async () => {
  const { data } = await kycApi.get("/officer/reviews");
  return data.data;
};

export const submitOfficerDecision = async (submissionId, { decision, reason }) => {
  const { data } = await kycApi.post(`/officer/submissions/${submissionId}/decision`, {
    decision,
    reason,
  });
  return data.data;
};

// Evidence blobs are fetched with the officer's bearer token and turned into
// short-lived object URLs; callers must revoke them when closing the review.
export const getOfficerSubmissionDocuments = async (submissionId) => {
  const { data } = await kycApi.get(`/officer/submissions/${submissionId}/documents`);
  return data.data;
};

export const getOfficerDocumentContent = async (documentId) => {
  const response = await kycApi.get(`/officer/documents/${documentId}/content`, {
    responseType: "blob",
  });

  const blob = response.data;
  const mimeType =
    response.headers["content-type"] || blob.type || "application/octet-stream";

  return {
    url: URL.createObjectURL(blob),
    mimeType,
  };
};

// Remembers the last uploaded document id per submission so the review UI can
// reload it after a page refresh (the status endpoint does not list documents).
const documentKey = (submissionId) => `meridian_kyc_document_${submissionId}`;

export const rememberKycDocumentId = (submissionId, documentId) => {
  try {
    if (submissionId && documentId) localStorage.setItem(documentKey(submissionId), documentId);
    else if (submissionId) localStorage.removeItem(documentKey(submissionId));
  } catch {
    // storage unavailable — ignore
  }
};

export const recallKycDocumentId = (submissionId) => {
  try {
    return submissionId ? localStorage.getItem(documentKey(submissionId)) : null;
  } catch {
    return null;
  }
};

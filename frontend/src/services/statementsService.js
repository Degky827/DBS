import { userApi } from "./api";

const unwrap = (response) => response.data.data;

export const getStatement = async ({ from, to } = {}) =>
  unwrap(
    await userApi.get("/statements", {
      params: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
    })
  );

const filenameFrom = (headers, fallback) => {
  const disposition = headers?.["content-disposition"];
  const match = typeof disposition === "string" && disposition.match(/filename="?([^";]+)"?/);
  return match ? match[1] : fallback;
};

// Downloads the signed statement through the authenticated axios instance so the
// JWT (and any refresh) is applied, then hands the blob to a temporary link.
export const downloadStatementPdf = async ({ from, to } = {}) => {
  const params = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  let response;
  try {
    response = await userApi.get("/statements/export.pdf", {
      params,
      responseType: "blob",
    });
  } catch (error) {
    // A failed export returns JSON in the blob body; decode it so the normal
    // error normalisation can surface the server's message.
    if (error?.response?.data instanceof Blob) {
      const text = await error.response.data.text();
      try {
        error.response.data = JSON.parse(text);
      } catch {
        error.response.data = undefined;
      }
    }
    throw error;
  }
  const fallback = `statement-${params.from || "recent"}-${params.to || "today"}.pdf`;
  const url = URL.createObjectURL(response.data);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filenameFrom(response.headers, fallback);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
};

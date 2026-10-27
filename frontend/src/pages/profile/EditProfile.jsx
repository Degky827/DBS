import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { Save, X, ImagePlus } from "lucide-react";
import FieldInput from "../../components/FieldInput";
import {
  getMyProfile,
  updateProfile,
  GENDER_OPTIONS,
  toDateInputValue,
} from "../../services/userService";
import { normalizeApiError } from "../../utils/apiError";
import { isUninitializedDate } from "../../utils/format";
import PageTransition, { StaggerGroup, StaggerItem } from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import { LoadingBlock, Spinner } from "../../components/ui/Spinner";

const EMPTY_FORM = {
  firstName: "",
  middleName: "",
  lastName: "",
  phoneNumber: "",
  gender: "",
  dateOfBirth: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  bio: "",
  avatarUrl: "",
};

const NAME_PATTERN = /^[A-Za-zÀ-ÿ' -]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

const createProfileForm = (profile = {}, registeredUser = {}) => ({
  firstName: profile.firstName || registeredUser.firstName || "",
  middleName: profile.middleName || registeredUser.middleName || "",
  lastName: profile.lastName || registeredUser.lastName || "",
  phoneNumber: profile.phoneNumber || registeredUser.phoneNumber || "",
  gender:
    !profile.gender ||
    (profile.gender === "prefer_not_to_say" &&
      registeredUser.gender &&
      registeredUser.gender !== "prefer_not_to_say")
      ? registeredUser.gender || profile.gender || ""
      : profile.gender,
  dateOfBirth: toDateInputValue(
    isUninitializedDate(profile.dateOfBirth) ? registeredUser.dateOfBirth : profile.dateOfBirth
  ),
  addressLine1: profile.addressLine1 || "",
  addressLine2: profile.addressLine2 || "",
  city: profile.city || "",
  state: profile.state || "",
  postalCode: profile.postalCode || "",
  country: profile.country || "",
  bio: profile.bio || "",
  avatarUrl: profile.avatarUrl || "",
});

export default function EditProfile() {
  const navigate = useNavigate();
  const authUser = useSelector((state) => state.auth.user);

  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [success, setSuccess] = useState("");
  const [avatarFile, setAvatarFile] = useState(null);
  const avatarPreviewRef = useRef("");
  const [avatarPreview, setAvatarPreview] = useState("");

  useEffect(() => {
    return () => {
      if (avatarPreviewRef.current) {
        URL.revokeObjectURL(avatarPreviewRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const user = await getMyProfile();
        if (!active) return;
        setForm(createProfileForm(user, authUser));
      } catch (err) {
        if (!active) return;
        setForm(createProfileForm({}, authUser));
        setLoadError(
          normalizeApiError(err).message ||
            "We couldn't load your saved profile. You can still edit the fields below."
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authUser]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0] || null;
    if (file && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      e.currentTarget.value = "";
      setErrors((prev) => ({
        ...prev,
        avatarFile: "Choose a PNG, JPEG, or WebP image",
      }));
      return;
    }

    if (avatarPreviewRef.current) {
      URL.revokeObjectURL(avatarPreviewRef.current);
    }
    avatarPreviewRef.current = file ? URL.createObjectURL(file) : "";
    setAvatarPreview(avatarPreviewRef.current);
    setAvatarFile(file);
    setErrors((prev) => ({ ...prev, avatarFile: undefined }));
    if (file) setServerError("");
  };

  const validateName = (label, value, required) => {
    const v = value.trim();
    if (!v) return required ? `${label} is required` : undefined;
    if (v.length < 2) return `${label} must be at least 2 characters`;
    if (v.length > 60) return `${label} must not exceed 60 characters`;
    if (!NAME_PATTERN.test(v)) return `${label} contains invalid characters`;
    return undefined;
  };

  const validate = () => {
    const next = {};

    const firstNameError = validateName("First name", form.firstName, true);
    if (firstNameError) next.firstName = firstNameError;

    const lastNameError = validateName("Last name", form.lastName, true);
    if (lastNameError) next.lastName = lastNameError;

    const middleNameError = validateName("Middle name", form.middleName, false);
    if (middleNameError) next.middleName = middleNameError;

    const phone = form.phoneNumber.trim();
    if (phone && !PHONE_PATTERN.test(phone)) {
      next.phoneNumber = "Enter a valid phone number (7–15 digits, optional +)";
    }

    if (form.dateOfBirth) {
      const d = new Date(form.dateOfBirth);
      if (Number.isNaN(d.getTime()) || d.getTime() >= Date.now()) {
        next.dateOfBirth = "Date of birth must be a valid date in the past";
      }
    }

    if (form.avatarUrl.trim()) {
      try {
        new URL(form.avatarUrl.trim());
      } catch {
        next.avatarUrl = "Avatar URL must be a valid URL";
      }
      if (form.avatarUrl.trim().length > 500) {
        next.avatarUrl = "Avatar URL must not exceed 500 characters";
      }
    }

    if (avatarFile && avatarFile.size > 5 * 1024 * 1024) {
      next.avatarFile = "Avatar image must be 5 MB or smaller";
    }

    if (form.bio && form.bio.length > 500) next.bio = "Bio must not exceed 500 characters";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // Only send non-empty fields; the backend requires at least one field.
  const buildPayload = () => {
    const payload = {};
    const put = (key, value) => {
      if (typeof value !== "string") return;
      const v = value.trim();
      if (v === "") return;
      payload[key] = v;
    };

    put("firstName", form.firstName);
    put("middleName", form.middleName);
    put("lastName", form.lastName);
    put("phoneNumber", form.phoneNumber);
    if (form.gender) payload.gender = form.gender;
    if (form.dateOfBirth) payload.dateOfBirth = form.dateOfBirth;
    put("addressLine1", form.addressLine1);
    put("addressLine2", form.addressLine2);
    put("city", form.city);
    put("state", form.state);
    put("postalCode", form.postalCode);
    put("country", form.country);
    put("bio", form.bio);
    if (!avatarFile) put("avatarUrl", form.avatarUrl);

    return payload;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError("");
    setSuccess("");
    if (!validate()) return;

    const payload = buildPayload();
    if (Object.keys(payload).length === 0 && !avatarFile) {
      setServerError("At least one profile field must be provided.");
      return;
    }

    setSubmitting(true);
    try {
      await updateProfile(payload, avatarFile);
      setSuccess("Profile updated successfully.");
      setTimeout(() => navigate("/profile/view"), 700);
    } catch (err) {
      const { message, fields } = normalizeApiError(err);
      if (Object.keys(fields).length) {
        setErrors((prev) => ({ ...prev, ...fields }));
      }
      setServerError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageTransition className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        backTo="/profile"
        backLabel="Profile"
        eyebrow="Account"
        title="Edit profile"
        description="Update your personal information, address and profile photo."
      />

      <Alert tone="warning">{loadError}</Alert>
      <Alert tone="error">{serverError}</Alert>
      <Alert tone="success">{success}</Alert>

      {loading ? (
        <LoadingBlock label="Loading your profile…" />
      ) : (
        <StaggerGroup as="form" onSubmit={handleSubmit} noValidate className="space-y-6">
          <StaggerItem className="card p-6">
            <h2 className="mb-5 text-[15px] font-extrabold text-navy-900">Personal details</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <FieldInput
                label="First name"
                name="firstName"
                value={form.firstName}
                onChange={handleChange}
                required
                error={errors.firstName}
                disabled={submitting}
              />
              <FieldInput
                label="Middle name"
                name="middleName"
                value={form.middleName}
                onChange={handleChange}
                error={errors.middleName}
                disabled={submitting}
              />
              <FieldInput
                label="Last name"
                name="lastName"
                value={form.lastName}
                onChange={handleChange}
                required
                error={errors.lastName}
                disabled={submitting}
              />
              <FieldInput
                label="Phone number"
                name="phoneNumber"
                type="tel"
                value={form.phoneNumber}
                onChange={handleChange}
                error={errors.phoneNumber}
                disabled={submitting}
              />
              <FieldInput
                label="Gender"
                name="gender"
                value={form.gender}
                onChange={handleChange}
                options={GENDER_OPTIONS}
                error={errors.gender}
                disabled={submitting}
              />
              <FieldInput
                label="Date of birth"
                name="dateOfBirth"
                type="date"
                value={form.dateOfBirth}
                onChange={handleChange}
                error={errors.dateOfBirth}
                disabled={submitting}
              />
            </div>
          </StaggerItem>

          <StaggerItem className="card p-6">
            <h2 className="mb-5 text-[15px] font-extrabold text-navy-900">Address</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <FieldInput
                label="Address line 1"
                name="addressLine1"
                value={form.addressLine1}
                onChange={handleChange}
                error={errors.addressLine1}
                disabled={submitting}
              />
              <FieldInput
                label="Address line 2"
                name="addressLine2"
                value={form.addressLine2}
                onChange={handleChange}
                error={errors.addressLine2}
                disabled={submitting}
              />
              <FieldInput
                label="City"
                name="city"
                value={form.city}
                onChange={handleChange}
                error={errors.city}
                disabled={submitting}
              />
              <FieldInput
                label="State / province"
                name="state"
                value={form.state}
                onChange={handleChange}
                error={errors.state}
                disabled={submitting}
              />
              <FieldInput
                label="Postal code"
                name="postalCode"
                value={form.postalCode}
                onChange={handleChange}
                error={errors.postalCode}
                disabled={submitting}
              />
              <FieldInput
                label="Country"
                name="country"
                value={form.country}
                onChange={handleChange}
                error={errors.country}
                disabled={submitting}
              />
            </div>
          </StaggerItem>

          <StaggerItem className="card p-6">
            <h2 className="mb-5 text-[15px] font-extrabold text-navy-900">About & photo</h2>
            <div className="space-y-5">
              <FieldInput
                label="Bio"
                name="bio"
                value={form.bio}
                onChange={handleChange}
                rows={4}
                error={errors.bio}
                disabled={submitting}
              />
              <FieldInput
                label="Avatar URL"
                name="avatarUrl"
                type="url"
                value={form.avatarUrl}
                onChange={handleChange}
                placeholder="https://example.com/avatar.jpg"
                error={errors.avatarUrl}
                disabled={submitting || Boolean(avatarFile)}
                hint="Optional. Ignored once a file is chosen below."
              />
              <div>
                <label htmlFor="avatarFile" className="field-label">
                  Upload a profile photo
                </label>
                <div className="flex flex-wrap items-center gap-4">
                  {avatarPreview || form.avatarUrl ? (
                    <img
                      src={avatarPreview || form.avatarUrl}
                      alt="Profile avatar preview"
                      className="h-16 w-16 rounded-full border border-ink-100 object-cover"
                    />
                  ) : (
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-navy-50 text-navy-500">
                      <ImagePlus size={22} />
                    </span>
                  )}
                  <input
                    id="avatarFile"
                    name="avatarFile"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleAvatarChange}
                    disabled={submitting}
                    className="field-input min-w-0 flex-1"
                  />
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  PNG, JPEG, or WebP; maximum file size 5 MB.
                </p>
                {errors.avatarFile && <p className="field-error">{errors.avatarFile}</p>}
              </div>
            </div>
          </StaggerItem>

          <StaggerItem className="flex items-center justify-end gap-3 pb-4">
            <button
              type="button"
              onClick={() => navigate("/profile/view")}
              className="btn-ghost"
              disabled={submitting}
            >
              <X size={15} /> Cancel
            </button>
            <button type="submit" className="btn-primary px-6" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner size={15} /> Saving…
                </>
              ) : (
                <>
                  <Save size={15} /> Save changes
                </>
              )}
            </button>
          </StaggerItem>
        </StaggerGroup>
      )}
    </PageTransition>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Save, X } from "lucide-react";
import MainLayout from "../../layouts/MainLayout";
import FieldInput from "../../components/FieldInput";
import { mockUser } from "../../mock/userService";

const INITIAL_FORM = {
  firstName: mockUser.firstName,
  middleName: mockUser.middleName,
  lastName: mockUser.lastName,
  phoneNumber: mockUser.phoneNumber,
  gender: mockUser.gender,
  dateOfBirth: mockUser.dateOfBirth,
  addressLine1: mockUser.addressLine1,
  addressLine2: mockUser.addressLine2,
  city: mockUser.city,
  state: mockUser.state,
  postalCode: mockUser.postalCode,
  country: mockUser.country,
  bio: mockUser.bio,
  avatarUrl: mockUser.avatarUrl || "",
};

const GENDER_OPTIONS = [
  { value: "", label: "Select gender" },
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
  { value: "Non-binary", label: "Non-binary" },
  { value: "Prefer not to say", label: "Prefer not to say" },
];

export default function EditProfile() {
  const navigate = useNavigate();
  const [form, setForm] = useState(INITIAL_FORM);
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!form.firstName.trim()) newErrors.firstName = "First name is required";
    if (!form.lastName.trim()) newErrors.lastName = "Last name is required";
    if (!form.email?.trim()) newErrors.email = "Email is required";
    setErrors(newErrors);
    if (Object.keys(newErrors).length === 0) {
      navigate("/profile");
    }
  };

  return (
    <MainLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900">Edit Profile</h1>
          <p className="mt-1 text-sm text-ink-500">Update your personal information below.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="card p-6">
            <h2 className="mb-5 text-[15px] font-extrabold text-navy-900">Personal Details</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <FieldInput
                label="First Name"
                name="firstName"
                value={form.firstName}
                onChange={handleChange}
                required
                error={errors.firstName}
              />
              <FieldInput
                label="Middle Name"
                name="middleName"
                value={form.middleName}
                onChange={handleChange}
              />
              <FieldInput
                label="Last Name"
                name="lastName"
                value={form.lastName}
                onChange={handleChange}
                required
                error={errors.lastName}
              />
              <FieldInput
                label="Phone Number"
                name="phoneNumber"
                type="tel"
                value={form.phoneNumber}
                onChange={handleChange}
              />
              <FieldInput
                label="Gender"
                name="gender"
                value={form.gender}
                onChange={handleChange}
                options={GENDER_OPTIONS}
              />
              <FieldInput
                label="Date of Birth"
                name="dateOfBirth"
                type="date"
                value={form.dateOfBirth}
                onChange={handleChange}
              />
            </div>
          </section>

          <section className="card p-6">
            <h2 className="mb-5 text-[15px] font-extrabold text-navy-900">Address</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <FieldInput
                label="Address Line 1"
                name="addressLine1"
                value={form.addressLine1}
                onChange={handleChange}
              />
              <FieldInput
                label="Address Line 2"
                name="addressLine2"
                value={form.addressLine2}
                onChange={handleChange}
              />
              <FieldInput
                label="City"
                name="city"
                value={form.city}
                onChange={handleChange}
              />
              <FieldInput
                label="State / Province"
                name="state"
                value={form.state}
                onChange={handleChange}
              />
              <FieldInput
                label="Postal Code"
                name="postalCode"
                value={form.postalCode}
                onChange={handleChange}
              />
              <FieldInput
                label="Country"
                name="country"
                value={form.country}
                onChange={handleChange}
              />
            </div>
          </section>

          <section className="card p-6">
            <h2 className="mb-5 text-[15px] font-extrabold text-navy-900">About</h2>
            <div className="space-y-5">
              <FieldInput
                label="Bio"
                name="bio"
                value={form.bio}
                onChange={handleChange}
                rows={4}
              />
              <FieldInput
                label="Avatar URL"
                name="avatarUrl"
                type="url"
                value={form.avatarUrl}
                onChange={handleChange}
                placeholder="https://example.com/avatar.jpg"
              />
            </div>
          </section>

          <div className="flex items-center justify-end gap-3 pb-4">
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="btn-ghost"
            >
              <X size={15} /> Cancel
            </button>
            <button type="submit" className="btn-primary w-auto! px-6!">
              <Save size={15} /> Save Changes
            </button>
          </div>
        </form>
      </div>
    </MainLayout>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  CheckCircle2,
  Info,
  LogOut,
  Pencil,
  Save,
  Star,
  X,
  Shield,
  Heart,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchWithAuth } from "@/lib/services/token";
import { useLanguage } from '@/contexts/LanguageContext';

type PrimaryCondition = "hypertension" | "heart_disease" | "diabetes_cardiac" | "high_cholesterol" | "other" | "";
type AccountStatus = "active" | "blocked" | "suspended";

type User = {
  id: string;
  email: string;
  createdAt: string;
  name: string;
  dateOfBirth: string;
  primaryCondition: PrimaryCondition;
  communicationPreference: string | null;
  preferredLanguage: string;
  riskTier: string;
  timezone: string;
  diagnosisDate: string | null;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  roles: string[];
};

type ProfileGetResponse = {
  id?: string;
  email?: string;
  name?: string;
  roles?: string[];
  emailVerified?: boolean;
  accountStatus?: AccountStatus;
  createdAt?: string;
  dateOfBirth?: string | null;
  primaryCondition?: string;
  communicationPreference?: string | null;
  preferredLanguage?: string;
  riskTier?: string;
  timezone?: string;
  diagnosisDate?: string | null;
  onboardingStatus?: string;
};

type ProfilePatchResponse = {
  message?: string;
  name?: string;
  dateOfBirth?: string;
  primaryCondition?: string;
  communicationPreference?: string | null;
  preferredLanguage?: string;
  timezone?: string;
  onboardingStatus?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

function formatPrimaryCondition(condition: string): string {
  const labels: Record<string, string> = {
    hypertension: "Hypertension (High Blood Pressure)",
    heart_disease: "Heart Disease",
    diabetes_cardiac: "Diabetes with Cardiac Risk",
    high_cholesterol: "High Cholesterol",
    other: "Other cardiovascular concern",
  };
  return labels[condition] || toTitleCase(condition || "N/A");
}

function toTitleCase(input: string) {
  return input.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatRoleLabel(role: string) {
  return toTitleCase(role);
}

function formatCommunicationPreference(pref: string | null | undefined): string {
  if (pref === "TEXT_FIRST") return "Text / Chat";
  if (pref === "AUDIO_FIRST") return "Audio / Voice";
  return "Not set";
}

function RiskTierBadge({ tier }: { tier: string | null | undefined }) {
  const { t } = useLanguage();
  if (tier === "HIGH")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
        style={{ backgroundColor: 'rgba(220,38,38,0.15)', color: '#dc2626' }}>
        {t('profile.highRisk')}
      </span>
    );
  if (tier === "ELEVATED")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
        style={{ backgroundColor: 'rgba(245,158,11,0.15)', color: '#d97706' }}>
        {t('profile.elevated')}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
      style={{ backgroundColor: 'rgba(22,163,74,0.12)', color: '#16a34a' }}>
      {t('profile.standard')}
    </span>
  );
}

const initialUserData: User = {
  id: "", email: "", createdAt: "", name: "", dateOfBirth: "",
  primaryCondition: "", communicationPreference: null,
  preferredLanguage: "English", riskTier: "STANDARD", timezone: "",
  diagnosisDate: null, accountStatus: "active", emailVerified: false, roles: [],
};

// ── UI helpers ────────────────────────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5"
      style={{ color: 'var(--brand-text-muted)' }}>
      {children}
    </label>
  );
}

function FieldValue({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm font-medium" style={{ color: 'var(--brand-text-primary)' }}>
      {children}
    </p>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded-xl text-sm font-medium border transition-colors focus:outline-none" +
  " bg-white border-[#E9D5FF] focus:border-[#7B00E0]";
const selectCls = inputCls + " cursor-pointer";

// Skeleton bone — a single animated purple bar
function Bone({ w, h = 14, r = 8, dark = false }: { w: number | string; h?: number; r?: number; dark?: boolean }) {
  return (
    <div className="animate-pulse flex-shrink-0" style={{
      width: w, height: h, borderRadius: r,
      backgroundColor: dark ? 'rgba(255,255,255,0.25)' : '#EDE9F6',
    }} />
  );
}

// Card section header (icon box + title) — always visible, not skeletonized
function CardHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}>
        {icon}
      </div>
      <h3 className="text-sm font-bold" style={{ color: 'var(--brand-text-primary)' }}>{title}</h3>
    </div>
  );
}

// Renders skeleton label+value or real label+value
function Field({
  label, value, loading, valueW = "70%",
}: { label: string; value: React.ReactNode; loading: boolean; valueW?: number | string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {loading ? <Bone w={valueW} h={14} /> : <>{value}</>}
    </div>
  );
}

export default function Profile() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading, logout, markOnboardingComplete } = useAuth();

  const [isEditing, setIsEditing] = useState(false);
  const [userData, setUserData] = useState<User>(initialUserData);
  const [serverSnapshot, setServerSnapshot] = useState<User>(initialUserData);
  const [timezones, setTimezones] = useState<string[]>([]);
  // Start true so skeleton shows on first paint
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loading = isAuthLoading || isProfileLoading || !userData.id;

  const updatePrimaryCondition = (condition: PrimaryCondition) =>
    setUserData((prev) => ({ ...prev, primaryCondition: condition }));

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };

  const formatShortMonthYear = (dateString?: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", { year: "numeric", month: "short" });
  };

  const toDateInputValue = (raw?: string | null) => {
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toISOString().slice(0, 10);
  };

  useEffect(() => {
    if (isAuthLoading) return;
    if (!user) router.replace("/register");
  }, [isAuthLoading, user, router]);

  useEffect(() => {
    try {
      const supported =
        typeof Intl !== "undefined" && (Intl as any).supportedValuesOf
          ? (Intl as any).supportedValuesOf("timeZone") : [];
      if (Array.isArray(supported) && supported.length > 0) { setTimezones(supported); return; }
    } catch { /* ignore */ }
    setTimezones([
      "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
      "Europe/London", "Europe/Paris", "Asia/Colombo", "Asia/Tokyo", "Australia/Sydney",
    ]);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (!API_BASE_URL) { setLoadError("Missing API configuration."); setIsProfileLoading(false); return; }

    const controller = new AbortController();
    setIsProfileLoading(true);
    setLoadError(null);

    async function fetchProfile() {
      try {
        const res = await fetchWithAuth(`${API_BASE_URL}/api/v2/auth/profile`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) {
          if (res.status === 401) { router.replace("/register"); return; }
          setLoadError("We couldn't load your profile. Please try again.");
          return;
        }
        const data: ProfileGetResponse = await res.json();
        setUserData((prev) => {
          const next: User = {
            ...prev,
            id: data.id ?? "",
            email: data.email ?? "",
            name: data.name ?? "",
            roles: Array.isArray(data.roles) ? data.roles : [],
            emailVerified: typeof data.emailVerified === "boolean" ? data.emailVerified : false,
            accountStatus: data.accountStatus ?? "active",
            createdAt: data.createdAt ?? "",
            dateOfBirth: data.dateOfBirth ?? "",
            primaryCondition: (data.primaryCondition as PrimaryCondition) ?? "",
            communicationPreference: data.communicationPreference ?? null,
            preferredLanguage: data.preferredLanguage ?? "English",
            riskTier: data.riskTier ?? "STANDARD",
            timezone: data.timezone ?? "",
            diagnosisDate: data.diagnosisDate ?? null,
          };
          setServerSnapshot(next);
          return next;
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setLoadError("We couldn't load your profile. Please try again.");
      } finally {
        setIsProfileLoading(false);
      }
    }

    void fetchProfile();
    return () => controller.abort();
  }, [user, router]);

  const handleCancelEdit = () => { setSaveError(null); setIsEditing(false); setUserData(serverSnapshot); };

  const handleSaveProfile = async () => {
    if (!API_BASE_URL) { setSaveError("Missing API configuration."); return; }
    setIsSaving(true); setSaveError(null);

    const timezoneLooksValid = userData.timezone && userData.timezone.includes("/");
    if (!timezoneLooksValid && userData.timezone) {
      setSaveError('Timezone must be a valid IANA identifier (e.g. "America/New_York")');
      setIsSaving(false); return;
    }

    try {
      const payload: Record<string, unknown> = {
        name: userData.name,
        dateOfBirth: toDateInputValue(userData.dateOfBirth),
        primaryCondition: userData.primaryCondition,
        communicationPreference: userData.communicationPreference || undefined,
        ...(timezoneLooksValid ? { timezone: userData.timezone } : {}),
      };
      const res = await fetchWithAuth(`${API_BASE_URL}/api/v2/auth/profile`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        try {
          const err = await res.json();
          const msg = Array.isArray(err?.message) ? err.message[0] : err?.message;
          setSaveError(msg || "We couldn't save your profile. Please try again.");
        } catch { setSaveError("We couldn't save your profile. Please try again."); }
        return;
      }
      const data: ProfilePatchResponse = await res.json();
      const next: User = {
        ...userData,
        name: data.name ?? userData.name,
        dateOfBirth: data.dateOfBirth ?? userData.dateOfBirth,
        primaryCondition: (data.primaryCondition as PrimaryCondition) ?? userData.primaryCondition,
        communicationPreference:
          data.communicationPreference !== undefined ? data.communicationPreference : userData.communicationPreference,
        preferredLanguage: data.preferredLanguage ?? userData.preferredLanguage,
        timezone: data.timezone ?? userData.timezone,
      };
      setServerSnapshot(next); setUserData(next); setIsEditing(false);
      if (data.onboardingStatus === "COMPLETED") markOnboardingComplete();
    } catch { setSaveError("We couldn't save your profile. Please try again."); }
    finally { setIsSaving(false); }
  };

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6"
        style={{ backgroundColor: 'var(--brand-background)' }}>
        <div className="text-center">
          <p className="font-semibold mb-4" style={{ color: 'var(--brand-alert-red)' }}>{loadError}</p>
          <button onClick={() => router.refresh()}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold border transition-colors"
            style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-primary)' }}>
            {t('profile.tryAgain')}
          </button>
        </div>
      </div>
    );
  }

  const initials = userData.name?.split(" ").map((n) => n[0]).join("").toUpperCase() || "U";

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--brand-background)' }}>
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 md:py-8">

        {/* ── Hero Card ── */}
        <div className="rounded-[20px] overflow-hidden mb-6 p-6 md:p-8"
          style={{ background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)' }}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">

            {/* Avatar + info */}
            <div className="flex items-center gap-4">
              {/* Avatar */}
              {loading ? (
                <Bone w={72} h={72} r={16} dark />
              ) : (
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center text-white text-2xl md:text-3xl font-bold flex-shrink-0"
                  style={{ backgroundColor: 'rgba(255,255,255,0.53)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
                  {initials}
                </div>
              )}

              <div className="space-y-2">
                {/* Name */}
                {loading ? <Bone w={160} h={22} dark /> : (
                  <h1 className="text-xl md:text-2xl font-bold text-white leading-tight">
                    {userData.name || t('profile.noNameSet')}
                  </h1>
                )}
                {/* Role */}
                {loading ? <Bone w={96} h={14} dark /> : (
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    {userData.roles.length ? userData.roles.map(formatRoleLabel).join(" / ") : t('profile.patient')}
                  </p>
                )}
                {/* Meta badges */}
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {loading ? (
                    <>
                      <Bone w={110} h={20} r={99} dark />
                      <Bone w={72} h={20} r={99} dark />
                      <Bone w={64} h={20} r={99} dark />
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        <Calendar className="w-3 h-3" /> {t('profile.joined')} {formatShortMonthYear(userData.createdAt)}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: 'white' }}>
                        <CheckCircle2 className="w-3 h-3" />
                        {userData.emailVerified ? t('profile.verified') : t('profile.unverified')}
                      </span>
                      <RiskTierBadge tier={userData.riskTier} />
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Action buttons — always visible */}
            <div className="flex flex-wrap items-center justify-center gap-2 self-start sm:self-center">
              {!isEditing ? (
                <button onClick={() => setIsEditing(true)} disabled={loading}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer w-[150px] disabled:opacity-50"
                  style={{ backgroundColor: 'rgba(255,255,255,0.53)', color: 'white' }}>
                  <Pencil className="w-3.5 h-3.5" /> {t('profile.editProfile')}
                </button>
              ) : (
                <>
                  <button onClick={handleCancelEdit} disabled={isSaving}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer w-[150px] disabled:opacity-50"
                    style={{ backgroundColor: 'rgba(255,255,255,0.53)', color: 'white' }}>
                    <X className="w-3.5 h-3.5" /> {t('common.cancel')}
                  </button>
                  <button onClick={() => void handleSaveProfile()} disabled={isSaving}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer w-[150px] disabled:opacity-50"
                    style={{ backgroundColor: 'white', color: '#7B00E0' }}>
                    <Save className="w-3.5 h-3.5" /> {isSaving ? t('common.saving') : t('profile.saveChanges')}
                  </button>
                </>
              )}
              <button onClick={logout}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer w-[150px]"
                style={{ backgroundColor: 'rgba(255,0,0,0.83)', color: 'white' }}>
                <LogOut className="w-3.5 h-3.5" /> {t('profile.logout')}
              </button>
            </div>
          </div>
        </div>

        {/* ── Content Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Left column */}
          <div className="lg:col-span-2 space-y-5">

            {/* Personal Information */}
            <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <CardHeader icon={<Info className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />}
                title={t('profile.personalInfo')} />

              {saveError && isEditing && (
                <div className="mb-4 px-4 py-3 rounded-xl text-sm font-semibold"
                  style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)' }}>
                  {saveError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Full Name */}
                <div>
                  <FieldLabel>{t('profile.name')}</FieldLabel>
                  {loading ? <Bone w="68%" h={14} /> : isEditing ? (
                    <input type="text" value={userData.name}
                      onChange={(e) => setUserData((p) => ({ ...p, name: e.target.value }))}
                      className={inputCls} style={{ color: 'var(--brand-text-primary)' }} />
                  ) : <FieldValue>{userData.name || "N/A"}</FieldValue>}
                </div>

                {/* Email */}
                <div>
                  <FieldLabel>{t('profile.email')}</FieldLabel>
                  {loading ? <Bone w="82%" h={14} /> : <FieldValue>{userData.email || "N/A"}</FieldValue>}
                </div>

                {/* Date of Birth */}
                <div>
                  <FieldLabel>{t('profile.dob')}</FieldLabel>
                  {loading ? <Bone w="58%" h={14} /> : isEditing ? (
                    <input type="date" value={toDateInputValue(userData.dateOfBirth)}
                      onChange={(e) => setUserData((p) => ({ ...p, dateOfBirth: e.target.value }))}
                      className={inputCls} style={{ color: 'var(--brand-text-primary)' }} />
                  ) : <FieldValue>{formatDate(userData.dateOfBirth)}</FieldValue>}
                </div>

                {/* Timezone */}
                <div>
                  <FieldLabel>{t('profile.timezone')}</FieldLabel>
                  {loading ? <Bone w="78%" h={14} /> : isEditing ? (
                    <select value={userData.timezone || ""}
                      onChange={(e) => setUserData((p) => ({ ...p, timezone: e.target.value }))}
                      className={selectCls} style={{ color: 'var(--brand-text-primary)' }}>
                      {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                      {userData.timezone && !timezones.includes(userData.timezone) && (
                        <option value={userData.timezone}>{userData.timezone}</option>
                      )}
                    </select>
                  ) : <FieldValue>{userData.timezone || "N/A"}</FieldValue>}
                </div>

                {/* Communication Preference */}
                <div>
                  <FieldLabel>{t('profile.communication')}</FieldLabel>
                  {loading ? <Bone w="52%" h={14} /> : isEditing ? (
                    <select value={userData.communicationPreference ?? ""}
                      onChange={(e) => setUserData((p) => ({ ...p, communicationPreference: e.target.value || null }))}
                      className={selectCls} style={{ color: 'var(--brand-text-primary)' }}>
                      <option value="">{t('profile.notSet')}</option>
                      <option value="TEXT_FIRST">{t('profile.textChat')}</option>
                      <option value="AUDIO_FIRST">{t('profile.audioVoice')}</option>
                    </select>
                  ) : <FieldValue>{userData.communicationPreference === "TEXT_FIRST" ? t('profile.textChat') : userData.communicationPreference === "AUDIO_FIRST" ? t('profile.audioVoice') : t('profile.notSet')}</FieldValue>}
                </div>

              </div>
            </div>

            {/* Health Information */}
            <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <CardHeader icon={<Heart className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />}
                title={t('profile.healthInfo')} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Primary Condition */}
                <div className="sm:col-span-2">
                  <FieldLabel>{t('profile.primaryCondition')}</FieldLabel>
                  {loading ? <Bone w="56%" h={14} /> : isEditing ? (
                    <select value={userData.primaryCondition}
                      onChange={(e) => updatePrimaryCondition(e.target.value as PrimaryCondition)}
                      className={selectCls} style={{ color: 'var(--brand-text-primary)' }}>
                      <option value="">{t('profile.selectCondition')}</option>
                      <option value="hypertension">Hypertension (High Blood Pressure)</option>
                      <option value="heart_disease">Heart Disease</option>
                      <option value="diabetes_cardiac">Diabetes with Cardiac Risk</option>
                      <option value="high_cholesterol">High Cholesterol</option>
                      <option value="other">Other cardiovascular concern</option>
                    </select>
                  ) : <FieldValue>{formatPrimaryCondition(userData.primaryCondition)}</FieldValue>}
                </div>

                {/* Diagnosis Date */}
                <div>
                  <FieldLabel>{t('profile.diagnosisDate')}</FieldLabel>
                  {loading ? <Bone w="60%" h={14} /> : (
                    <FieldValue>{userData.diagnosisDate ? formatDate(userData.diagnosisDate) : t('profile.notProvided')}</FieldValue>
                  )}
                </div>

                {/* Risk Tier */}
                <div>
                  <FieldLabel>{t('profile.riskTier')}</FieldLabel>
                  {loading ? <Bone w={72} h={22} r={99} /> : <RiskTierBadge tier={userData.riskTier} />}
                </div>
              </div>
            </div>

            {/* Roles & Permissions */}
            <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <CardHeader icon={<Star className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />}
                title={t('profile.rolesPermissions')} />

              {loading ? (
                /* Skeleton role card */
                <div className="flex items-center justify-between p-3 rounded-xl" style={{ backgroundColor: '#F5F0FF' }}>
                  <div className="flex items-center gap-3">
                    <Bone w={32} h={32} r={10} />
                    <div className="space-y-1.5">
                      <Bone w={88} h={13} />
                      <Bone w={136} h={10} r={5} />
                    </div>
                  </div>
                  <Bone w={48} h={22} r={99} />
                </div>
              ) : userData.roles.length > 0 ? (
                <div className="space-y-3">
                  {userData.roles.map((role, i) => (
                    <div key={`${role}-${i}`}
                      className="flex items-center justify-between p-3 rounded-xl"
                      style={{ backgroundColor: 'var(--brand-primary-purple-light)', border: '1px solid #E9D5FF' }}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: 'var(--brand-primary-purple)' }}>
                          <Star className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold capitalize" style={{ color: 'var(--brand-text-primary)' }}>
                            {role.replace("_", " ")}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                            Full access to {role.includes("admin") ? "admin" : role.includes("provider") ? "provider" : "user"} features
                          </p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold"
                        style={{ backgroundColor: 'rgba(22,163,74,0.12)', color: '#16a34a' }}>
                        {t('profile.active')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>{t('profile.noRoles')}</p>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-5">

            {/* Account Info */}
            <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <CardHeader icon={<Info className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />}
                title={t('profile.accountInfo')} />
              <div className="space-y-4">
                {/* Account Created */}
                <Field label={t('profile.accountCreated')} value={<FieldValue>{formatDate(userData.createdAt)}</FieldValue>}
                  loading={loading} valueW="72%" />
                {/* Email Status */}
                <div>
                  <FieldLabel>{t('profile.emailStatus')}</FieldLabel>
                  {loading ? <Bone w={80} h={22} r={99} /> : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                      style={userData.emailVerified
                        ? { backgroundColor: 'rgba(22,163,74,0.12)', color: '#16a34a' }
                        : { backgroundColor: 'var(--brand-background)', color: 'var(--brand-text-muted)' }}>
                      <CheckCircle2 className="w-3 h-3" />
                      {userData.emailVerified ? t('profile.verified') : t('profile.unverified')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Account Status */}
            {/* <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <CardHeader icon={<Activity className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />}
                title="Account Status" />
              <div className="space-y-3"> */}
                {/* Status row */}
                {/* <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--brand-text-secondary)' }}>Status</span>
                  {loading ? <Bone w={60} h={22} r={99} /> : (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold capitalize"
                      style={userData.accountStatus === "active"
                        ? { backgroundColor: 'rgba(22,163,74,0.12)', color: '#16a34a' }
                        : userData.accountStatus === "suspended"
                          ? { backgroundColor: 'rgba(245,158,11,0.12)', color: '#d97706' }
                          : { backgroundColor: 'rgba(220,38,38,0.12)', color: '#dc2626' }}>
                      {toTitleCase(userData.accountStatus)}
                    </span>
                  )}
                </div> */}
                {/* 2FA row */}
                {/* <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--brand-text-secondary)' }}>Two-Factor Auth</span>
                  {loading ? <Bone w={64} h={22} r={99} /> : (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold"
                      style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}>
                      Enabled
                    </span>
                  )}
                </div> */}
                {/* Session timeout row */}
                {/* <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--brand-text-secondary)' }}>Session Timeout</span>
                  {loading ? <Bone w={40} h={14} /> : (
                    <span className="text-sm font-semibold" style={{ color: 'var(--brand-text-primary)' }}>30 min</span>
                  )}
                </div> */}
              {/* </div>
            </div>       */}

            {/* Security */}
            <div className="bg-white rounded-2xl p-6" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <CardHeader icon={<Shield className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />}
                title={t('profile.security')} />
              {loading ? <Bone w="100%" h={40} r={12} /> : (
                <button className="w-full py-2.5 rounded-xl text-sm font-semibold transition-colors"
                  style={{ color: 'var(--brand-alert-red)', backgroundColor: 'rgba(220,38,38,0.06)' }}>
                  {t('profile.deactivateAccount')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

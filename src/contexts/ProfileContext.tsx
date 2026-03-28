"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import {
  getActiveProfile,
  loginOrRegister,
  logout as logoutStorage,
  pullProfileData,
  hydrateLocalStorage,
  pushLocalStorageToCloud,
  type Profile,
  type AuthResult,
} from "@/lib/profile-storage";
import { isSupabaseConfigured } from "@/lib/supabase";

type ProfileCtx = {
  profile: Profile | null;
  loading: boolean;
  configured: boolean;
  modalOpen: boolean;
  setModalOpen: (v: boolean) => void;
  login: (username: string, pin: string) => Promise<AuthResult>;
  logout: () => void;
};

const Ctx = createContext<ProfileCtx>({
  profile: null,
  loading: true,
  configured: false,
  modalOpen: false,
  setModalOpen: () => {},
  login: async () => ({ ok: false, error: "Not initialised" }),
  logout: () => {},
});

export function useProfile() {
  return useContext(Ctx);
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    const stored = getActiveProfile();
    if (stored) {
      setProfile(stored);
      pullProfileData()
        .then((data) => {
          if (data) hydrateLocalStorage(data);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (username: string, pin: string): Promise<AuthResult> => {
    const result = await loginOrRegister(username, pin);
    if (result.ok) {
      setProfile(result.profile);

      const data = await pullProfileData();
      if (data) {
        const hasCloudData =
          data.watchlists.length > 0 ||
          data.screens.length > 0 ||
          Object.keys(data.flags).length > 0 ||
          Object.keys(data.settings).length > 0;

        if (hasCloudData) {
          hydrateLocalStorage(data);
        } else {
          pushLocalStorageToCloud();
        }
      }

      window.dispatchEvent(new CustomEvent("profile-changed"));
    }
    return result;
  }, []);

  const logout = useCallback(() => {
    logoutStorage();
    setProfile(null);
  }, []);

  return (
    <Ctx.Provider value={{ profile, loading, configured, modalOpen, setModalOpen, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

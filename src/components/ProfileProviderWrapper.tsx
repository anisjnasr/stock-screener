"use client";

import { ProfileProvider } from "@/contexts/ProfileContext";
import ProfileModal from "@/components/ProfileModal";
import type { ReactNode } from "react";

export default function ProfileProviderWrapper({ children }: { children: ReactNode }) {
  return (
    <ProfileProvider>
      {children}
      <ProfileModal />
    </ProfileProvider>
  );
}

import dynamic from "next/dynamic";

const DesktopAvatarScene = dynamic(
  () => import("@/components/avatar-desktop/DesktopAvatarScene"),
  { ssr: false }
);

export default function DesktopPage() {
  return <DesktopAvatarScene />;
}

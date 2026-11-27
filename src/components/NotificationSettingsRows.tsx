import { useEffect, useState } from "react";
import { previewAppSound, SOUND_STYLES, type SoundChoice } from "@/lib/app-sounds";
import { t } from "@/lib/i18n";
import {
  setFinishedNotifications,
  setNotificationFeed,
  setReportNotifications,
  setSoundChoice,
  useFinishedNotifications,
  useNotificationFeed,
  useReportNotifications,
  useSoundChoice,
} from "@/lib/notification-preferences";
import { requestNotificationPermission } from "@/lib/notify";
import { Select } from "./Select";
import { SettingRow, Switch } from "./SettingsPrimitives";

export function NotificationRows({ simple = false }: { simple?: boolean }) {
  return (
    <>
      <DeviceNotificationsRow simple={simple} />
      <ReportNotificationsRow simple={simple} />
      <NotificationSoundsRow simple={simple} />
      <NotificationFeedRow simple={simple} />
    </>
  );
}

const currentPermission = (): NotificationPermission => (typeof Notification !== "undefined" ? Notification.permission : "default");

/** Every mounted row, so a permission one row asked for reaches the others at once. */
const permissionRows = new Set<(permission: NotificationPermission) => void>();
const publishPermission = (permission: NotificationPermission) => {
  for (const row of permissionRows) row(permission);
};

/** The person may change the site permission elsewhere, so it is read again whenever the app comes back. */
function useNotificationPermission() {
  const [permission, setPermission] = useState(currentPermission);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setPermission(currentPermission());
    };
    permissionRows.add(setPermission);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      permissionRows.delete(setPermission);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return [permission, publishPermission] as const;
}

/** A browser shows nothing until it is asked from a click. */
export function DeviceNotificationsRow({ simple = false }: { simple?: boolean }) {
  const [permission, setPermission] = useNotificationPermission();
  const enabled = useFinishedNotifications();
  if (typeof Notification === "undefined") return null;

  const blocked = permission === "denied";
  const toggle = async () => {
    if (permission === "granted") return setFinishedNotifications(!enabled);
    const next = await requestNotificationPermission();
    if (!next) return;
    setPermission(next);
    if (next === "granted") setFinishedNotifications(true);
  };

  return (
    <SettingRow
      title={t("settings.deviceNotifications.title")}
      subtitle={t(blocked ? "settings.deviceNotifications.blocked" : simple ? "settings.simple.deviceNotifications" : "settings.deviceNotifications.subtitle")}
    >
      <Switch
        checked={permission === "granted" && enabled}
        disabled={blocked}
        aria-label={t("settings.deviceNotifications.show")}
        onClick={() => void toggle()}
      />
    </SettingRow>
  );
}

const SOUND_CHOICES: readonly SoundChoice[] = [...SOUND_STYLES, "off"];

/** Scheduled routine reports, apart from chat replies; it can be changed once the browser lets this app notify. */
export function ReportNotificationsRow({ simple = false }: { simple?: boolean }) {
  const [permission] = useNotificationPermission();
  const enabled = useReportNotifications();
  if (typeof Notification === "undefined") return null;
  const allowed = permission === "granted";
  return (
    <SettingRow title={t("settings.reportNotifications.title")} subtitle={t(simple ? "settings.simple.reportNotifications" : "settings.reportNotifications.subtitle")}>
      <Switch
        checked={allowed && enabled}
        disabled={!allowed}
        aria-label={t("settings.reportNotifications.show")}
        onClick={() => setReportNotifications(!enabled)}
      />
    </SettingRow>
  );
}

export function NotificationSoundsRow({ simple = false }: { simple?: boolean }) {
  const choice = useSoundChoice();
  return (
    <SettingRow title={t("settings.appSounds.title")} subtitle={t(simple ? "settings.simple.appSounds" : "settings.appSounds.subtitle")}>
      <Select size="sm" className="w-full max-w-[240px]"
        value={choice}
        aria-label={t("settings.appSounds.choose")}
        onChange={(event) => {
          const next = SOUND_CHOICES.find((one) => one === event.target.value);
          if (!next) return;
          setSoundChoice(next);
          if (next !== "off") previewAppSound(next);
        }}
      >
        {SOUND_CHOICES.map((one) => (
          <option key={one} value={one}>{t(`settings.appSounds.${one}`)}</option>
        ))}
      </Select>
    </SettingRow>
  );
}

export function NotificationFeedRow({ simple = false }: { simple?: boolean }) {
  const enabled = useNotificationFeed();
  return (
    <SettingRow title={t("settings.notificationFeed.title")} subtitle={t(simple ? "settings.simple.notificationFeed" : "settings.notificationFeed.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.notificationFeed.show")}
        onClick={() => setNotificationFeed(!enabled)}
      />
    </SettingRow>
  );
}

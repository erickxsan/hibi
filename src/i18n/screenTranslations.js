import { COMMUNITY_TRANSLATIONS } from "./communityTranslations.js";
import { HOME_TRANSLATIONS } from "./homeTranslations.js";
import { SETTINGS_TRANSLATIONS } from "./settingsTranslations.js";
import { TRACKING_TRANSLATIONS } from "./trackingTranslations.js";
import { TUTORIAL_TRANSLATIONS } from "./tutorialTranslations.js";
import { registerSpanishTranslations } from "./translations.js";

// The screens are lazy; importing this module from each of them keeps their Spanish copy out of
// the first download. Registering twice is harmless. The order matches the former merge order.
for (const table of [
  HOME_TRANSLATIONS,
  COMMUNITY_TRANSLATIONS,
  TRACKING_TRANSLATIONS,
  SETTINGS_TRANSLATIONS,
  TUTORIAL_TRANSLATIONS,
]) {
  registerSpanishTranslations(table);
}

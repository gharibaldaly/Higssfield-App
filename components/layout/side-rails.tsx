import { getTranslations } from "next-intl/server";

/**
 * Vertical labels at both edges of wide screens (after the side bars on sloshseltzer.com): the
 * studio's name at the start, and at the end a stitched thread that fills as the page scrolls
 * (a CSS scroll timeline, see .rail-thread). Decorative; hidden below xl where the gutters are
 * too narrow.
 */
export async function SideRails() {
  const [t, ta] = await Promise.all([getTranslations("rails"), getTranslations("app")]);
  return (
    <div aria-hidden className="hidden xl:block">
      <p className="rail rail-start hud">{ta("name")}</p>
      <div className="rail rail-end">
        <span className="hud">{t("scroll")}</span>
        <span className="rail-thread">
          <span />
        </span>
      </div>
    </div>
  );
}

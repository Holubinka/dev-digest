import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../messages/en/skills.json";
import { SkillTypeBadge } from "./SkillTypeBadge";
import { TYPE_COLORS } from "./constants";

afterEach(cleanup);

function renderBadge(type: Skill["type"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillTypeBadge type={type} />
    </NextIntlClientProvider>,
  );
}

describe("SkillTypeBadge", () => {
  it.each(["rubric", "convention", "security", "custom"] as const)(
    "labels a %s skill from the message file, not from a hardcoded string",
    (type) => {
      renderBadge(type);
      expect(screen.getByText(messages.listItem.type[type])).toBeInTheDocument();
    },
  );

  it("colours the badge by type", () => {
    renderBadge("security");
    expect(screen.getByText("security")).toHaveStyle({ color: TYPE_COLORS.security });
  });
});

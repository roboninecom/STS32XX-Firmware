# Documentation languages

[English](en/README.md) · [Русский](ru/README.md) · [Español](es/README.md) · [Français](fr/README.md) · [Deutsch](de/README.md) · [Português (Brasil)](pt-BR/README.md) · [简体中文](zh-CN/README.md) · [日本語](ja/README.md) · [हिन्दी](hi/README.md) · [العربية](ar/README.md)

Each language folder mirrors the complete set of 22 original Markdown documents: the README, Quick start, detailed reference, firmware and host documentation, and every tool guide. The layout and same-page language selector follow [SO-ARM102](https://github.com/roboninecom/SO-ARM102/tree/main/docs/i18n).

The original English files outside this directory are the technical source. Localized pages retain the original code blocks, inline code, numeric values and external destinations. Stable explicit anchors preserve section links across languages. Images, calibration reference poses, diagrams and videos are shared; text within media is not translated. Text-only procedures remain Markdown lists and tables.

Non-English pages are machine translations with automated structural validation and targeted terminology review. They have **not** received complete native-speaker review. Do not interpret passing structural checks as certification of the translated meaning. Vendor notices are translated for reading; their original wording and licenses remain authoritative.

## Maintaining translations

1. Edit the original English document first. Keep its language navigation block.
2. Update the corresponding document in every language, including the English mirror. Translate all changed prose; preserve commands, flags, register addresses, units, limits and safety qualifications.
3. Preserve explicit heading anchors and the `translated-content` boundaries. Point documentation links to the same language; use relative paths back to shared repository media and source code.
4. Compare the entire changed section with its English source. Update both source hashes in `manifest.json` only after the translation has been synchronized. Hash the UTF-8 source after removing the `documentation-languages` block, trimming surrounding whitespace and appending one LF; the checker exposes `source_body` for this normalization.
5. Run `python .github/scripts/check_translations.py`. Review the rendered Markdown as well. CI runs the same offline check when documentation changes.

The manifest records the source version and review status for each page. Do not mark a translation as reviewed by a native speaker without that review. Never update hashes merely to hide stale content.

## What validation covers

The checker verifies document/language coverage, source hashes, section and table counts, numbered steps, image/link counts, exact fenced and inline code, numerical values, external destinations, local files, section anchors and same-page language navigation. It does not translate text, contact translation services or access hardware. Python's standard library is sufficient.

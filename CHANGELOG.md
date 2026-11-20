# Changelog

## 0.1.0

Initial release.

- Extracts numbers, prices, percentages, URLs, emails, `{placeholders}` and terms to keep from a string.
- Reads `1,000` and `1.000`, `7.50` and `7,5`, and Bengali, Thai, Devanagari and Arabic-Indic digits as the same facts.
- `compareFacts` reports facts that are missing, changed or extra in a translation.
- `checkTranslations` checks flat or nested i18next and next-intl style JSON, key by key.
- `translation-facts` CLI with `--keep`, `--extra` and `--json`, exit code 1 on problems and 2 on usage errors.
- No runtime dependencies.

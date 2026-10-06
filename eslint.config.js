// כלל אחד בלבד, והוא חוסם: rules-of-hooks.
// hook אחרי return מוקדם (או בתוך תנאי) מפיל מסך שלם ב-production (React #310) —
// כך נפל כרטיס התלמידה. tsc ובדיקות המסד לא רואים את זה; הכלל הזה כן.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
];

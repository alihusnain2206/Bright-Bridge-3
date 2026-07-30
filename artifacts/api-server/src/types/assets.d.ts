/** esbuild base64 loader — PDF files are imported as a base64 string */
declare module "*.pdf" {
  const base64: string;
  export default base64;
}

/** A `.eta` file is a prompt, imported as its text. The bundler inlines it (a text loader for `.eta`), so nothing
 *  reads a file at run time. This declaration only gives the import a type: a module that imports a `.eta`
 *  file has to be bundled, or loaded through the test rig's loader hook, to run at all. */
declare module '*.eta' {
  const content: string;
  export default content;
}

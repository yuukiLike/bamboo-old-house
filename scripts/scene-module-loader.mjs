// Node-only resolution for offline generators that reuse the scene's TS code.
export function resolve(specifier,context,nextResolve){
 if(context.parentURL?.includes('/src/components/scene/')&&specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)){
  return nextResolve(`${specifier}.ts`,context);
 }
 return nextResolve(specifier,context);
}

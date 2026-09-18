import { encodeProject, decodeProject } from "./project.mjs";
self.onmessage = async ({ data: { method, args } }) => {
  try {
    const result =
      method === "encode"
        ? await encodeProject(args.bytes, args.name, args.state, {
            blob: args.blob,
            local: true,
          })
        : await decodeProject(args.input, { local: true });
    const bytes =
      result instanceof Uint8Array
        ? result
        : result?.bytes instanceof Uint8Array
          ? result.bytes
          : null;
    self.postMessage({ result }, bytes ? [bytes.buffer] : []);
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};

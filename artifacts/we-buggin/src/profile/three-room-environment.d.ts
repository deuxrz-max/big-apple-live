// Local shim: three ships untyped here and no new deps are allowed.
declare module "three/addons/environments/RoomEnvironment.js" {
  export const RoomEnvironment: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

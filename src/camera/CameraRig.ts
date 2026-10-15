/**
 * Player cameras: chase (near / far) with spring smoothing, drift-aware yaw,
 * speed-based FOV and wall avoidance; bonnet and cockpit views locked to the
 * body.
 */
import * as THREE from 'three';
import type { CameraMode } from '../core/settings';

export const CAMERA_ORDER: CameraMode[] = ['chase', 'far', 'hood', 'cockpit'];
export const CAMERA_LABEL: Record<CameraMode, string> = { chase: 'Chase camera', far: 'Far chase camera', hood: 'Bonnet camera', cockpit: 'Cockpit camera' };

export interface CameraTarget {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
  /** World-space velocity. */
  vx: number;
  vz: number;
  forwardSpeed: number;
  steer: number;
}

export class CameraRig {
  mode: CameraMode = 'chase';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yaw = 0;
  private fov = 62;
  private snap = true;
  private shake = 0;
  private tmp = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  setMode(m: CameraMode): void {
    this.mode = m;
    this.snap = true;
  }

  next(): CameraMode {
    const i = CAMERA_ORDER.indexOf(this.mode);
    this.setMode(CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length]);
    return this.mode;
  }

  reset(): void {
    this.snap = true;
  }

  impact(strength: number): void {
    this.shake = Math.min(1, this.shake + strength);
  }

  update(dt: number, t: CameraTarget, raycast: (ax: number, az: number, bx: number, bz: number) => number, groundAt: (x: number, z: number, y: number) => number): void {
    const cam = this.camera;
    const speed = Math.hypot(t.vx, t.vz);
    const fx = -Math.sin(t.heading);
    const fz = -Math.cos(t.heading);
    let targetFov: number;
    if (this.mode === 'chase' || this.mode === 'far') {
      // Yaw follows the heading, leaning towards the velocity in a slide.
      let desiredYaw = t.heading;
      if (speed > 6 && t.forwardSpeed > 0) {
        const velYaw = Math.atan2(-t.vx, -t.vz);
        let d = velYaw - desiredYaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        desiredYaw += d * 0.45;
      }
      let dy = desiredYaw - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += this.snap ? dy : dy * (1 - Math.exp(-dt * 4.2));
      const far = this.mode === 'far';
      const dist = (far ? 9.6 : 6.3) + Math.min(2.2, speed * 0.028);
      const height = (far ? 3.3 : 2.05) + Math.min(0.6, speed * 0.006);
      const bx = -Math.sin(this.yaw);
      const bz = -Math.cos(this.yaw);
      let px = t.x - bx * dist;
      let pz = t.z - bz * dist;
      // Keep the camera on the near side of walls.
      const hit = raycast(t.x, t.z, px, pz);
      if (hit < 1) {
        const f = Math.max(0.28, hit - 0.06);
        px = t.x + (px - t.x) * f;
        pz = t.z + (pz - t.z) * f;
      }
      let py = t.y + height;
      py = Math.max(py, groundAt(px, pz, t.y + 1) + 0.6);
      this.tmp.set(px, py, pz);
      if (this.snap) this.pos.copy(this.tmp);
      else this.pos.lerp(this.tmp, 1 - Math.exp(-dt * 9));
      this.look.set(t.x + fx * 3.5, t.y + 1.15, t.z + fz * 3.5);
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      targetFov = 60 + Math.min(16, speed * 0.2);
    } else {
      // Locked to the car body.
      const cockpit = this.mode === 'cockpit';
      // Right-hand drive: the driver's eyes sit behind the wheel on the right.
      const local = cockpit ? new THREE.Vector3(0.37, 1.13, 0.66) : new THREE.Vector3(0, 1.2, -0.65);
      this.e.set(t.pitch, t.heading, t.roll);
      this.q.setFromEuler(this.e);
      local.applyQuaternion(this.q);
      cam.position.set(t.x + local.x, t.y + local.y, t.z + local.z);
      const lookYaw = t.heading + (cockpit ? t.steer * 0.35 : 0);
      this.e.set(t.pitch - (cockpit ? 0.06 : 0.04), lookYaw, t.roll * 0.6);
      cam.quaternion.setFromEuler(this.e);
      this.yaw = t.heading;
      this.pos.copy(cam.position);
      targetFov = (cockpit ? 70 : 66) + Math.min(10, speed * 0.12);
    }
    if (this.shake > 0.001) {
      const s = this.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 6);
    }
    // Subtle high-speed buzz.
    if (speed > 45 && (this.mode === 'chase' || this.mode === 'far')) cam.position.y += (Math.random() - 0.5) * 0.012 * (speed - 45) * 0.1;
    this.fov += (targetFov - this.fov) * (this.snap ? 1 : 1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    this.snap = false;
  }
}

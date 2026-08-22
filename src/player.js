// ============================================================================
// player.js — 旅人の足。
// 急がない(速度は低くキャップ)。慣性と控えめな頭の揺れ。
// 地面は多層(街路・階段・城壁歩廊)を plan が解決し、足はそれに従う。
// 歩幅の節目で足音イベントを出す — 音はゾーンの真実を語る。
// ============================================================================
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

const EYE = 1.62;

export class Player {
  constructor(plan, spawn) {
    this.plan = plan;
    this.x = spawn.x; this.z = spawn.z;
    this.yaw = spawn.yaw ?? 0;
    this.pitch = spawn.pitch ?? 0;
    const g = plan.groundAt(this.x, this.z, spawn.groundY ?? 500);   // 生まれは上層優先(壁上プリセット)
    this.groundY = g.y;
    this.smoothY = g.y;
    this.zone = g.zone;
    this.vx = 0; this.vz = 0;
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.onStep = null;
    this.frozen = false;   // 撮影用
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0021;
    this.pitch = clamp(this.pitch - dy * 0.0019, -1.35, 1.35);
  }

  teleport(x, z, yaw, pitch) {
    this.x = x; this.z = z;
    if (yaw !== undefined) this.yaw = yaw;
    if (pitch !== undefined) this.pitch = pitch;
    const g = this.plan.groundAt(x, z, 200);   // 上の層を優先(壁の上のプリセット)
    this.groundY = g.y; this.smoothY = g.y; this.zone = g.zone;
    this.vx = 0; this.vz = 0;
  }

  update(dt, keys) {
    if (this.frozen) return;
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const maxV = run ? 2.35 : 1.5;   // 散歩の速度 — 急ぐと街が死ぬ
    // 向きはキーでも変えられる(←→ / Q・E)。マウスは任意。
    const turn = ((keys.has('ArrowLeft') || keys.has('KeyQ')) ? 1 : 0)
               - ((keys.has('ArrowRight') || keys.has('KeyE')) ? 1 : 0);
    if (turn) this.yaw += turn * dt * 1.75;
    let ix = 0, iz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
    if (keys.has('KeyA')) ix -= 1;
    if (keys.has('KeyD')) ix += 1;
    const len = Math.hypot(ix, iz);
    let tx = 0, tz = 0;
    if (len > 0) {
      ix /= len; iz /= len;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      // 前方 = (−sin yaw, −cos yaw)
      tx = (-sy * -iz + cy * ix);
      tz = (-cy * -iz - sy * ix);
      tx *= maxV; tz *= maxV;
    }
    // 慣性(立ち上がりも止まりも柔らかく)
    const acc = len > 0 ? 6.5 : 8.5;
    this.vx += (tx - this.vx) * Math.min(1, dt * acc);
    this.vz += (tz - this.vz) * Math.min(1, dt * acc);
    const speed = Math.hypot(this.vx, this.vz);

    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;

    // 地面の解決(足元の層)
    const g = this.plan.groundAt(nx, nz, this.groundY);
    // 登れない段差・落ちる縁・海面(y<0.4)へは進めない。
    // 下りを許すと、層の継ぎ目の数センチの隙間から歩廊を踏み外して落ちる。
    if (g.y > this.groundY + 1.45 || g.y < this.groundY - 1.2 || g.y < 0.4) {
      nx = this.x; nz = this.z;
    } else {
      this.groundY = g.y;
      this.zone = g.zone;
    }
    // 衝突(家・壁・縁)
    const c = this.plan.collide(nx, nz, 0.35, this.groundY + 1.0);
    this.x = c.x; this.z = c.z;
    // 押し出された分だけ地面を再解決
    const g2 = this.plan.groundAt(this.x, this.z, this.groundY);
    if (g2.y <= this.groundY + 1.45 && g2.y >= this.groundY - 1.2 && g2.y >= 0.4) {
      this.groundY = g2.y; this.zone = g2.zone;
    }

    // 足の上下は滑らかに(階段は流れになる)
    const dy = this.groundY - this.smoothY;
    this.smoothY += clamp(dy, -dt * 7, dt * 7) * Math.min(1, dt * 60);
    this.smoothY += (this.groundY - this.smoothY) * Math.min(1, dt * 6);

    // 頭の揺れと歩幅
    const speedF = clamp(speed / maxV, 0, 1);
    this.bobAmp += (speedF - this.bobAmp) * Math.min(1, dt * 4);
    if (speedF > 0.05) {
      const freq = 1.85 * (0.8 + speedF * 0.45);
      const prev = this.bobPhase;
      this.bobPhase += dt * freq * Math.PI * 2;
      // 一歩 = 位相 π ごと
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) {
        if (this.onStep) this.onStep(this.zone, 0.7 + speedF * 0.5);
      }
    }
  }

  // カメラへ書き込む
  pose(camera) {
    const bobY = Math.sin(this.bobPhase * 2) * 0.028 * this.bobAmp;
    const bobR = Math.sin(this.bobPhase) * 0.006 * this.bobAmp;
    camera.position.set(this.x, this.smoothY + EYE + bobY, this.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, bobR);
  }
}

/** 可复现的 mulberry32 伪随机数生成器（合成图与测试用） */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0,1) 均匀分布 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 均值 0、标准差 1 的近似高斯（Irwin-Hall） */
  gaussian(): number {
    return (
      this.next() +
      this.next() +
      this.next() +
      this.next() +
      this.next() +
      this.next() -
      3
    );
  }
}

#pragma once
// AUTO-GENERATED: 4th-order Butterworth low-pass (20 Hz @ 200 Hz), cascaded biquads (direct form II transposed).
#define SOS_N 2
static const float SOS_B[SOS_N][3] = {{0.00482434314f, 0.00964868627f, 0.00482434314f}, {1.0f, 2.0f, 1.0f}};
static const float SOS_A[SOS_N][2] = {{-1.0485996f, 0.296140343f}, {-1.32091343f, 0.632738769f}};  // a1, a2 (a0 = 1)
static const float SOS_ZI[SOS_N][2] = {{0.0731320009f, -0.0182616748f}, {0.922043681f, -0.55478245f}};   // multiply by first sample

struct ChannelFilter { float z[SOS_N][2]; bool init; };
static inline void filter_reset(ChannelFilter &c) { c.init = false; }
static inline float filter_step(ChannelFilter &c, float x) {
  if (!c.init) { for (int s = 0; s < SOS_N; s++) { c.z[s][0] = SOS_ZI[s][0] * x; c.z[s][1] = SOS_ZI[s][1] * x; } c.init = true; }
  float v = x;
  for (int s = 0; s < SOS_N; s++) {
    float y = SOS_B[s][0] * v + c.z[s][0];
    c.z[s][0] = SOS_B[s][1] * v - SOS_A[s][0] * y + c.z[s][1];
    c.z[s][1] = SOS_B[s][2] * v - SOS_A[s][1] * y;
    v = y;
  }
  return v;
}

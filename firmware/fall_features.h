#pragma once
#include <math.h>
// AUTO-GENERATED. Mirrors compute_features() of the notebook. Units: acc in g, gyro in deg/s.
#define FS_HZ 50
#define WIN_N 150
#define N_FEATURES 18
// Feature order: acc_mean, acc_std, acc_min, acc_max, acc_range, acc_peak_pos, acc_pre_min, acc_post_std,
// acc_post_dev, acc_jerk_max, acc_frac_low, acc_frac_high, tilt_change_deg, gyr_mean, gyr_std, gyr_max,
// gyr_post_mean, gyr_peak_near_acc_peak
static inline void compute_fall_features(const float acc[WIN_N][3], const float gyr[WIN_N][3], float *f) {
  float svm[WIN_N], gm[WIN_N];
  float sum = 0.f, mn = 1e9f, mx = -1e9f, gsum = 0.f, gmx = -1e9f;
  int peak = 0;
  for (int i = 0; i < WIN_N; i++) {
    svm[i] = sqrtf(acc[i][0]*acc[i][0] + acc[i][1]*acc[i][1] + acc[i][2]*acc[i][2]);
    gm[i]  = sqrtf(gyr[i][0]*gyr[i][0] + gyr[i][1]*gyr[i][1] + gyr[i][2]*gyr[i][2]);
    sum += svm[i]; gsum += gm[i];
    if (svm[i] < mn) mn = svm[i];
    if (svm[i] > mx) { mx = svm[i]; peak = i; }   // first maximum, like numpy argmax
    if (gm[i] > gmx) gmx = gm[i];
  }
  const int N1 = FS_HZ, NH = FS_HZ / 2;
  const float mean = sum / WIN_N, gmean = gsum / WIN_N;
  float var = 0.f, gvar = 0.f;
  for (int i = 0; i < WIN_N; i++) { var += (svm[i]-mean)*(svm[i]-mean); gvar += (gm[i]-gmean)*(gm[i]-gmean); }
  float pre_min = 1e9f;
  for (int i = 0; i <= peak; i++) if (svm[i] < pre_min) pre_min = svm[i];
  float pm = 0.f, gpm = 0.f;
  for (int i = WIN_N - N1; i < WIN_N; i++) { pm += svm[i]; gpm += gm[i]; }
  pm /= N1; gpm /= N1;
  float pv = 0.f;
  for (int i = WIN_N - N1; i < WIN_N; i++) pv += (svm[i]-pm)*(svm[i]-pm);
  float jerk = 0.f;
  for (int i = 1; i < WIN_N; i++) { float d = fabsf(svm[i]-svm[i-1]); if (d > jerk) jerk = d; }
  int nlow = 0, nhigh = 0;
  for (int i = 0; i < WIN_N; i++) { if (svm[i] < 0.5f) nlow++; if (svm[i] > 2.0f) nhigh++; }
  float v0[3] = {0,0,0}, v1[3] = {0,0,0};
  for (int i = 0; i < NH; i++) for (int k = 0; k < 3; k++) { v0[k] += acc[i][k]; v1[k] += acc[WIN_N-NH+i][k]; }
  float dot = 0.f, n0 = 0.f, n1 = 0.f;
  for (int k = 0; k < 3; k++) { v0[k] /= NH; v1[k] /= NH; dot += v0[k]*v1[k]; n0 += v0[k]*v0[k]; n1 += v1[k]*v1[k]; }
  float c = dot / (sqrtf(n0) * sqrtf(n1) + 1e-9f);
  if (c > 1.f) c = 1.f; if (c < -1.f) c = -1.f;
  float gnear = -1e9f;
  for (int i = (peak - NH > 0 ? peak - NH : 0); i <= (peak + NH < WIN_N - 1 ? peak + NH : WIN_N - 1); i++)
    if (gm[i] > gnear) gnear = gm[i];
  f[0]  = mean;  f[1] = sqrtf(var / WIN_N); f[2] = mn; f[3] = mx; f[4] = mx - mn;
  f[5]  = (float)peak / (WIN_N - 1); f[6] = pre_min;
  f[7]  = sqrtf(pv / N1); f[8] = fabsf(pm - 1.0f); f[9] = jerk * FS_HZ;
  f[10] = (float)nlow / WIN_N; f[11] = (float)nhigh / WIN_N; f[12] = acosf(c) * 57.29578f;
  f[13] = gmean; f[14] = sqrtf(gvar / WIN_N); f[15] = gmx; f[16] = gpm; f[17] = gnear;
}

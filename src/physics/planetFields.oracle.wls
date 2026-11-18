#!/usr/bin/env wolframscript
(* src/physics/planetFields.oracle.wls

   An independent oracle for Mercury's and Venus's gravity fields
   (environment.js, docs/physics/environment.md): the acceleration of each
   field's harmonics (degree 2 up, C20 included) at six points, straight
   from the PDS files, written to src/physics/fixtures/planet_fields.json.

     wolframscript -file src/physics/planetFields.oracle.wls

   It needs the Wolfram Engine (free for developers) and the two PDS files
   that npm run fetch:environment caches in ~/.cache/digital-orrery.

   Method: not geopotential.js's. The potential is summed directly,
     U = GM/r sum_n (R/r)^n sum_m Pbar_nm(sin lat) (C_nm cos m lon + S_nm sin m lon),
   with the fully normalised Legendre functions from Wolfram's LegendreP
   (whose Condon-Shortley phase is taken out), at 50 digits, and
   differentiated by central differences of 1e-12 km. *)

cache = FileNameJoin[{$HomeDirectory, ".cache", "digital-orrery"}];
readSHADR[file_] := Module[{lines, rows, toNum},
  lines = StringSplit[Import[file, "Text", CharacterEncoding -> "ISOLatin1"], {"\r\n", "\n"}];
  rows = Select[Map[StringTrim /@ StringSplit[#, ","] &, lines], Length[#] >= 6 &];
  (* MGNP180U's header row follows an SFDU marker on the same line. *)
  rows = Map[ReplacePart[#, 1 -> Last[StringSplit[First[#]]]] &, rows];
  rows = Select[rows, AllTrue[Take[#, 6], StringMatchQ[#, NumberString | RegularExpression["[-+]?\\d*\\.\\d+[eE][-+]?\\d+"]] &] &];
  toNum[s_] := Interpreter["Number"][StringReplace[s, {StartOfString ~~ "." -> "0.", "-." -> "-0."}]];
  {toNum /@ Take[rows[[1]], 6], Map[{ToExpression[#[[1]]], ToExpression[#[[2]]], toNum[#[[3]]], toNum[#[[4]]]} &, Rest[rows]]}];
fields = <|
  "mercury" -> readSHADR[FileNameJoin[{cache, "gravity-mercury", "jgmess_160a_sha.tab"}]],
  "venus" -> readSHADR[FileNameJoin[{cache, "gravity-venus", "shgj180u.a01"}]]|>;

pbar[n_, m_, x_] := Sqrt[(2 - KroneckerDelta[m, 0]) (2 n + 1) (n - m)!/(n + m)!] (-1)^m LegendreP[n, m, x];
mkU[{head_, coeffs_}, nmax_] := Module[{R = SetPrecision[head[[1]], 50], gm = SetPrecision[head[[2]], 50], cs},
  cs = SetPrecision[Select[coeffs, 2 <= #[[1]] <= nmax &], 50];
  Function[{x, y, z}, Module[{r = Sqrt[x^2 + y^2 + z^2], s, lam},
    s = z/r; lam = ArcTan[x, y];
    gm/r Total[Map[(R/r)^#[[1]] pbar[#[[1]], #[[2]], s] (#[[3]] Cos[#[[2]] lam] + #[[4]] Sin[#[[2]] lam]) &, cs]]]]];
grad[U_, p_] := Module[{h = 10^-12}, Table[(U @@ (p + h UnitVector[3, i]) - U @@ (p - h UnitVector[3, i]))/(2 h), {i, 3}]];
pt[R_, latd_, lond_, hkm_] := SetPrecision[(R + hkm) {Cos[latd Degree] Cos[lond Degree], Cos[latd Degree] Sin[lond Degree], Sin[latd Degree]}, 50];

(* Mercury: the equator, the northern plains MESSENGER flew low over, and
   the south at 500 km. Venus: Maxwell Montes and Atla Regio at 300 km,
   and the south at 1,000 km. *)
pts = {{"mercury", 0, 0, 200}, {"mercury", 70, 300, 200}, {"mercury", -30, 120, 500},
  {"venus", 65, 3, 300}, {"venus", 9, 200, 300}, {"venus", -40, 80, 1000}};
out = Flatten[Table[Module[{f = fields[p[[1]]], q},
    q = pt[f[[1, 1]], p[[2]], p[[3]], p[[4]]];
    Table[<|"body" -> p[[1]], "latDeg" -> p[[2]], "lonDeg" -> p[[3]], "heightKm" -> p[[4]], "degree" -> n,
      "r" -> N[q, 17], "accel" -> Re[N[grad[mkU[f, n], q], 16]]|>, {n, {20, 50, 80}}]], {p, pts}]];
Export[FileNameJoin[{DirectoryName[$InputFileName], "fixtures", "planet_fields.json"}],
  <|"source" -> "planetFields.oracle.wls: a direct Legendre sum of jgmess_160a_sha.tab (JGMESS160A) and shgj180u.a01 (MGNP180U), PDS Geosciences Node, at 50 digits",
    "units" -> "r: body-fixed km; accel: km/s^2, the harmonics of degree 2 to degree (C20 included, no point mass)",
    "points" -> out|>, "RawJSON"];
Print[Length[out], " points"];

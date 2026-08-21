#!/usr/bin/env node
/**
 * Portão de encerramento: **a sessão não declara "pode encerrar" sem que alguém tenha medido.**
 *
 * ## O defeito que o criou (2026-08-21)
 *
 * Duas vezes no mesmo dia, a sessão disse ao dono *"pode encerrar"* / *"está tudo gravado"*, ele
 * perguntou **"tudo da memória do chat e arquivos da sessão estão gravados no repo?"**, e a
 * conferência achou pendência **das duas vezes**:
 *
 * 1. O achado grave (`CEO-G9`) morava **só no `HANDOFF.md`** — o arquivo que, no próprio cabeçalho,
 *    manda a próxima sessão apagá-lo. Morreria com ele.
 * 2. O dublê que exercitou o coletor da carteira vivia em **`/tmp`** e morria com a sessão — e dois
 *    PRs afirmavam *"exercitado com dublê"*. **A prova citada não existia.**
 *
 * Taxa de achado quando o dono pergunta: **2 de 2.** Isso não é azar, é ausência de medição — e
 * quem estava medindo era **ele**. A régua é interna (`LL-INEG-0021`); se quem percebe é o dono, a
 * sessão já falhou antes.
 *
 * ## Por que isto é um HOOK e não mais uma regra
 *
 * A regra **já existe**, e no arquivo de maior autoridade da casa:
 * `LL-INEG-0004` ("Sessão pode terminar sem aviso — grave na hora") e `LL-INEG-0022` ("confira item
 * a item antes de encerrar"). Estava escrita, e foi violada assim mesmo — duas vezes, no mesmo dia,
 * pela sessão que a tinha lido.
 *
 * Esta casa já nomeou esse padrão: *"comentário não é mecanismo"* (`LL-CICD-0148`) e *"regra
 * publicada sem catraca no próprio quintal é recomendação, não regra"*. Texto endereçado ao modelo
 * depende de o modelo lembrar. **Um `Stop` hook é executado pelo harness, fora do alcance do
 * modelo** — é o único ponto desta arquitetura que não depende de memória nem de boa vontade.
 * Escrever o inegociável nº 23 seria cometer o mesmo erro com outro número.
 *
 * ## O gatilho — por que ele não atrapalha
 *
 * O portão **não barra todo turno**. Ele só age quando a última mensagem do assistente **afirma
 * encerramento ou completude** ("pode encerrar", "está tudo gravado", "nada pendente"). A afirmação
 * é que é o defeito: dizer sem medir. Turno normal passa reto, sem custo.
 *
 * ## Modos
 *
 *   node scripts/checar-encerramento.mjs            # relatório (0 = limpo, 1 = pendência)
 *   node scripts/checar-encerramento.mjs --hook     # Stop hook: lê JSON no stdin, 2 = barra
 *
 * ## A regra de ouro deste script
 *
 * Ele **nunca** reporta "limpo" para o que não conseguiu medir. Cada fonte sai como `medido` ou
 * `SEM MEDIÇÃO`, e `SEM MEDIÇÃO` **barra uma vez** — nunca eternamente, porque `stop_hook_active`
 * impede o segundo bloqueio e travar a sessão para sempre seria pior que o defeito.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const MODO_HOOK = process.argv.includes("--hook");

/**
 * O `Stop` hook entrega os seus dados como JSON no **stdin** — inclusive o `transcript_path`.
 * Ler isto antes de qualquer medição não é estilo: sem o caminho do transcript, a varredura do
 * que a sessão gravou fora do repositório (a medição que pega o caso do dublê em `/tmp`) não
 * teria insumo, e sairia como SEM MEDIÇÃO em toda execução.
 */
let entradaHook = {};
if (MODO_HOOK) {
  try {
    const cru = readFileSync(0, "utf8");
    if (cru.trim()) entradaHook = JSON.parse(cru);
  } catch {
    /* sem stdin utilizável: as medições ainda rodam, e o transcript sai como SEM MEDIÇÃO */
  }
}

/* ─── afirmações que ligam o portão ───────────────────────────────────────── */
const AFIRMA_ENCERRAMENTO = [
  /pode\s+(encerrar|fechar|dar\s+por\s+encerrad)/i,
  /(sess[ãa]o|turno|trabalho)\s+(est[áa]\s+)?(encerrad|fechad|conclu[íi]d|finalizad)/i,
  /nada\s+(pendente|em\s+aberto|falta)/i,
  /(tudo|est[áa]\s+tudo)\s+(gravad|salv|commitad|mesclad|no\s+repo)/i,
  /n[ãa]o\s+h[áa]\s+(nada\s+)?pend[êe]ncia/i,
  /pronto\s+para\s+(encerrar|fechar)/i,
];

/* ─── caminhos que NÃO sobrevivem à sessão ────────────────────────────────── */
const EFEMEROS = [/^\/tmp\//, /^\/var\/tmp\//, /^\/dev\/shm\//, /\/scratchpad\//];
/** Extensões que carregam trabalho. `.log`, `.txt` e afins são ruído de execução. */
const CARREGA_TRABALHO = /\.(m?[jt]sx?|py|sh|bash|rb|go|rs|java|cs|php|sql|ya?ml|json|md|html?|css)$/i;
/** Arquivo que o próprio cabeçalho declara descartável. */
const AUTODECLARADO_DESCARTAVEL = /\b(apague|apagar|delete|descart[áa]vel|tempor[áa]rio|ef[êe]mero)\b/i;

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...opts }).trim();
}

const achados = [];
const semMedicao = [];

/* ─── 1. raiz do repositório ──────────────────────────────────────────────── */
let raiz;
try {
  raiz = git(["rev-parse", "--show-toplevel"]);
} catch {
  // Fora de um repositório não há o que este portão proteja. Sair verde aqui é correto,
  // e é a ÚNICA saída verde sem medição neste script.
  console.log("ℹ️  fora de um repositório git — portão de encerramento não se aplica.");
  process.exit(0);
}

/* ─── 2. árvore suja ──────────────────────────────────────────────────────── */
try {
  const sujo = git(["status", "--porcelain"]).split("\n").filter(Boolean);
  if (sujo.length > 0) {
    achados.push({
      titulo: `${sujo.length} arquivo(s) não commitado(s) na árvore`,
      detalhe: sujo.slice(0, 10).map((l) => `      ${l}`).join("\n"),
      saida: "Commite (ou descarte de propósito, dizendo qual e por quê).",
    });
  }
} catch (err) {
  semMedicao.push(`estado da árvore (\`git status\`): ${err instanceof Error ? err.name : "erro"}`);
}

/* ─── 3. trabalho que existe só nesta branch ──────────────────────────────── */
const quieto = { stdio: ["ignore", "pipe", "ignore"] };

/**
 * Repositório sem `origin` (clone local, protótipo, worktree solta) **não tem base** contra a qual
 * comparar. Isso é "não se aplica", não "não consegui medir" — e a diferença é load-bearing: SEM
 * MEDIÇÃO barra, e barrar toda sessão de um repo sem remoto transformaria o portão em algo que
 * alguém desliga. É o mesmo idioma que a `LL-TESTES-0172` separa: *não se aplica* × *não pôde ser
 * lido* produzem a mesma ausência de achado e exigem desfechos opostos.
 */
let temOrigin = false;
try {
  temOrigin = git(["remote"], quieto).split("\n").includes("origin");
} catch {
  /* sem `git remote` utilizável, o bloco abaixo sai como SEM MEDIÇÃO, que é o correto */
}

if (!temOrigin) {
  /* nada a comparar: o portão simplesmente não opina sobre base neste repositório */
} else {
  try {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], quieto);
    let base = "origin/main";
    try {
      base = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], quieto);
    } catch {
      /* origin/HEAD não resolvido: origin/main é o padrão desta casa */
    }
    if (branch !== base.replace("origin/", "")) {
      const soAqui = git(["rev-list", "--count", `${base}..HEAD`], quieto);
      if (Number(soAqui) > 0) {
        achados.push({
          titulo: `${soAqui} commit(s) existem só em \`${branch}\` — não estão em \`${base}\``,
          detalhe: git(["log", "--oneline", `${base}..HEAD`], quieto).split("\n").map((l) => `      ${l}`).join("\n"),
          saida: "Abra o PR e mescle, ou diga explicitamente que fica para a próxima sessão E onde isso está registrado.",
        });
      }
    }
  } catch (err) {
    semMedicao.push(`comparação com a base: ${err instanceof Error ? err.name : "erro"}`);
  }
}

/* ─── 4. o que esta sessão escreveu FORA do repositório ───────────────────── */
/** Extrai caminhos absolutos que a sessão gravou, lendo o transcript da própria sessão. */
function caminhosGravados(transcript) {
  const vistos = new Set();
  const linhas = readFileSync(transcript, "utf8").split("\n");
  for (const linha of linhas) {
    if (!linha.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(linha);
    } catch {
      continue; // linha truncada no fim do arquivo: não é motivo para abortar a varredura
    }
    const blocos = obj?.message?.content;
    if (!Array.isArray(blocos)) continue;
    for (const b of blocos) {
      if (b?.type !== "tool_use" || !b.input) continue;
      // Ferramentas de arquivo declaram o caminho; Bash esconde no comando.
      for (const campo of ["file_path", "notebook_path", "path"]) {
        if (typeof b.input[campo] === "string") vistos.add(b.input[campo]);
      }
      if (typeof b.input.command === "string") {
        for (const m of b.input.command.matchAll(/(?:^|[\s>|"'=])(\/(?:tmp|var\/tmp|dev\/shm|home|root)\/[^\s"'|;)&]+)/g)) {
          vistos.add(m[1]);
        }
      }
    }
  }
  return [...vistos];
}

const transcript =
  entradaHook.transcript_path ||
  process.env.CLAUDE_TRANSCRIPT_PATH ||
  process.argv.find((a) => a.endsWith(".jsonl"));
if (transcript && existsSync(transcript)) {
  try {
    const foraDoRepo = caminhosGravados(transcript)
      .filter((p) => isAbsolute(p))
      .filter((p) => EFEMEROS.some((re) => re.test(p)) || relative(raiz, resolve(p)).startsWith(".."))
      .filter((p) => CARREGA_TRABALHO.test(p))
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false; // já sumiu: não há o que salvar
        }
      });
    if (foraDoRepo.length > 0) {
      achados.push({
        titulo: `${foraDoRepo.length} arquivo(s) com trabalho vivem FORA do repositório e morrem com a sessão`,
        detalhe: foraDoRepo.slice(0, 10).map((p) => `      ${p}`).join("\n"),
        saida:
          "Se algum deles sustenta uma AFIRMAÇÃO sua (dublê, sonda, harness, medição citada em PR), ele é PROVA:\n" +
          "      versione antes de encerrar. Prova que morre com a sessão é afirmação sem lastro.",
      });
    }
  } catch (err) {
    semMedicao.push(`arquivos escritos fora do repositório: ${err instanceof Error ? err.name : "erro"}`);
  }
} else {
  semMedicao.push(
    "arquivos escritos fora do repositório — sem o transcript da sessão não há o que varrer"
  );
}

/* ─── 5. arquivo autodeclarado descartável carregando conteúdo ────────────── */
try {
  const versionados = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const descartaveis = versionados.filter((f) => /^(HANDOFF|SCRATCH|TEMP|RASCUNHO)[^/]*\.md$/i.test(f));
  for (const f of descartaveis) {
    const cabecalho = readFileSync(f, "utf8").split("\n").slice(0, 25).join("\n");
    if (AUTODECLARADO_DESCARTAVEL.test(cabecalho)) {
      achados.push({
        titulo: `\`${f}\` se declara descartável e está carregando conteúdo`,
        detalhe: `      o próprio cabeçalho manda apagá-lo — o que só existe aqui MORRE com ele`,
        saida:
          "Todo achado, decisão ou pendência dentro dele precisa ter cópia num arquivo durável\n" +
          "      (regra/lição da biblioteca, memória do projeto, ADR). Confira item a item.",
      });
    }
  }
} catch (err) {
  semMedicao.push(`arquivos autodeclarados descartáveis: ${err instanceof Error ? err.name : "erro"}`);
}

/* ─── relatório ───────────────────────────────────────────────────────────── */
function relatorio() {
  const partes = [];
  if (achados.length > 0) {
    partes.push(`❌ ${achados.length} pendência(s) antes de encerrar:\n`);
    for (const a of achados) {
      partes.push(`   • ${a.titulo}`);
      if (a.detalhe) partes.push(a.detalhe);
      partes.push(`      ↳ ${a.saida}\n`);
    }
  }
  if (semMedicao.length > 0) {
    partes.push(`⚠️  ${semMedicao.length} fonte(s) SEM MEDIÇÃO — não confunda com "limpo":\n`);
    for (const s of semMedicao) partes.push(`   • ${s}`);
    partes.push("");
  }
  return partes.join("\n");
}

/* ─── modo hook ───────────────────────────────────────────────────────────── */
if (MODO_HOOK) {
  const entrada = entradaHook;

  // Já estamos numa continuação forçada por este portão: não barrar de novo.
  // Sem isto, uma pendência que a sessão decide (legitimamente) não resolver trava o turno para
  // sempre — e portão que não pode ser respondido vira portão que alguém desliga.
  if (entrada.stop_hook_active === true) process.exit(0);

  const ultima = String(entrada.last_assistant_message ?? "");
  const afirmou = AFIRMA_ENCERRAMENTO.some((re) => re.test(ultima));
  if (!afirmou) process.exit(0); // turno comum: o portão não tem o que fazer

  if (achados.length === 0 && semMedicao.length === 0) process.exit(0); // afirmou e está limpo

  process.stderr.write(
    "🔒 PORTÃO DE ENCERRAMENTO — você afirmou que a sessão pode encerrar, e a medição discorda.\n\n" +
      relatorio() +
      "\nO que fazer AGORA, nesta ordem:\n" +
      "  1. Resolva o que é resolvível (commite, mescle, versione a prova).\n" +
      "  2. O que ficar por resolver, GRAVE num arquivo durável — não na thread, não no `/tmp`,\n" +
      "     não num arquivo que se declara descartável.\n" +
      "  3. Só então repita ao dono que pode encerrar, dizendo o que ficou e onde está registrado.\n\n" +
      "Isto é `LL-INEG-0004` e `LL-INEG-0022`. As duas já existiam quando este defeito aconteceu\n" +
      "duas vezes no mesmo dia — por isso agora quem cobra é o harness, não o seu próprio texto.\n"
  );
  process.exit(2); // 2 = impede o encerramento e devolve a conversa ao modelo
}

/* ─── modo relatório ──────────────────────────────────────────────────────── */
if (achados.length === 0 && semMedicao.length === 0) {
  console.log("✅ árvore limpa, nada só na branch, nenhum trabalho fora do repositório, nenhum arquivo descartável carregando conteúdo.");
  process.exit(0);
}
console.error(relatorio());
process.exit(1);

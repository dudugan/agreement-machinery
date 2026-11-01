%% am-thesis.cls: the PDF edition of Agreement Machinery.
%%
%% Adapted from yale-thesis.cls by Jackson Petty (https://github.com/jopetty/yale-thesis, MIT licence,
%% see LICENSE-yale-thesis): the same report-class layout, 12pt Computer Modern, letter paper,
%% 1.5in binding margin, double spacing and microtype. The title page states this project's details
%% instead of the GSAS doctoral wording, and no abstract file is required.
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{am-thesis}[2026/11/01 Agreement Machinery thesis class]

\DeclareOption*{\PassOptionsToClass{\CurrentOption}{report}}
\ProcessOptions\relax
\LoadClass[letterpaper,12pt]{report}

%% margins, as yale-thesis
\RequirePackage[top=1in, bottom=1in, left=1.5in, right=1in, headheight=15pt]{geometry}

%% typography, as yale-thesis
\RequirePackage{microtype}
\RequirePackage{setspace}
\doublespacing

%% metadata
\newcommand\advisor[1]{\def\am@advisor{#1}}
\newcommand\department[1]{\def\am@department{#1}}
\newcommand\institution[1]{\def\am@institution{#1}}
\newcommand\subtitle[1]{\def\am@subtitle{#1}}
\advisor{}\department{}\institution{}\subtitle{}

\renewcommand\maketitle{%
  \begin{titlepage}
  \begin{singlespace}
  \begin{center}
    \vspace*{1.2in}
    {\LARGE \@title\par}
    \ifx\am@subtitle\@empty\else\vspace{1em}{\large\itshape \am@subtitle\par}\fi
    \vfill
    by\\[0.5em]
    \@author
    \par\vspace{2.5em}
    Advisor: \am@advisor
    \par\vfill
    \am@department\\
    \am@institution\\[0.5em]
    \@date
    \vspace*{0.6in}
  \end{center}
  \end{singlespace}
  \end{titlepage}
  %% copyright page
  \begin{titlepage}
    \vspace*{1.3in}
    \begin{singlespace}\begin{center}
      Copyright \textcopyright{} \@date{} by \@author\\
      All rights reserved.
    \end{center}\end{singlespace}
  \end{titlepage}
}

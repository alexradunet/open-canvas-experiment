function initQuizzes() {
  document.querySelectorAll('.quiz').forEach(quiz => {
    quiz.querySelectorAll('.quiz-check').forEach(btn => {
      btn.addEventListener('click', () => {
        const question = btn.closest('.quiz-question');
        const selected = question.querySelector('input[type="radio"]:checked');
        const feedback = question.querySelector('.quiz-feedback');
        if (!selected) return;
        const isCorrect = selected.value === 'correct';
        feedback.className = 'quiz-feedback ' + (isCorrect ? 'correct' : 'incorrect');
        feedback.style.display = 'block';
        btn.disabled = true;
        question.querySelectorAll('input[type="radio"]').forEach(r => r.disabled = true);
      });
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQuizzes);
} else {
  initQuizzes();
}

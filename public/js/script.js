// Social Media App - Interactive Functionality
document.addEventListener('DOMContentLoaded', function() {
    initializeAnimations();
    initializeNavigationInteractions();
    console.log('Social media app initialized');
});

// Initialize smooth animations for post cards
function initializeAnimations() {
    const postCards = document.querySelectorAll('.post-card');
    
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    postCards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = 'all 0.6s ease';
        observer.observe(card);
    });
}

// Initialize navigation interactions
function initializeNavigationInteractions() {
    const navLinks = document.querySelectorAll('.nav-link, .mobile-nav-item');
    navLinks.forEach(link => {
        // Skip links that actually need to navigate
        if (link.getAttribute('href') && !link.getAttribute('href').startsWith('#')) {
            return;
        }
        
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Remove active class from all links
            navLinks.forEach(l => l.classList.remove('active'));
            
            // Add active class to clicked link
            this.classList.add('active');
        });
    });
}

// Toggle like functionality
async function toggleLike(postId) {
    const likeBtn = document.getElementById(`like-${postId}`);
    const likeCount = document.getElementById(`like-count-${postId}`);
    
    if (!likeBtn || !likeCount) {
        console.error('Like elements not found for post:', postId);
        return;
    }
    
    // Prevent double-clicking
    if (likeBtn.disabled) return;
    likeBtn.disabled = true;
    
    // Add visual feedback
    likeBtn.style.transform = 'scale(0.95)';
    
    try {
        const response = await fetch(`/api/posts/${postId}/like`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Update UI
        likeCount.textContent = data.likeCount;
        
        if (data.isLiked) {
            likeBtn.classList.add('liked');
            showToast('❤️ Post liked!');
        } else {
            likeBtn.classList.remove('liked');
            showToast('💔 Post unliked');
        }
        
    } catch (error) {
        console.error('Error toggling like:', error);
        showToast('Failed to update like. Please try again.', 'error');
    } finally {
        // Restore button
        likeBtn.style.transform = 'scale(1)';
        likeBtn.disabled = false;
    }
}

// Toggle comments section visibility
function toggleComments(postId) {
    const commentsSection = document.getElementById(`comments-${postId}`);
    
    if (!commentsSection) {
        console.error('Comments section not found for post:', postId);
        return;
    }
    
    if (commentsSection.style.display === 'none' || !commentsSection.style.display) {
        commentsSection.style.display = 'block';
        // Focus on comment input
        const commentInput = document.getElementById(`comment-input-${postId}`);
        if (commentInput) {
            setTimeout(() => commentInput.focus(), 100);
        }
    } else {
        commentsSection.style.display = 'none';
    }
}

// Add comment functionality
async function addComment(postId) {
    const commentInput = document.getElementById(`comment-input-${postId}`);
    const commentsList = document.getElementById(`comments-list-${postId}`);
    const commentCount = document.getElementById(`comment-count-${postId}`);
    
    if (!commentInput || !commentsList || !commentCount) {
        console.error('Comment elements not found for post:', postId);
        return;
    }
    
    const content = commentInput.value.trim();
    
    if (!content) {
        showToast('Please enter a comment', 'error');
        return;
    }
    
    if (content.length > 500) {
        showToast('Comment is too long (max 500 characters)', 'error');
        return;
    }
    
    // Disable input during request
    commentInput.disabled = true;
    const originalPlaceholder = commentInput.placeholder;
    commentInput.placeholder = 'Adding comment...';
    
    try {
        const response = await fetch(`/api/posts/${postId}/comment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to add comment');
        }
        
        const data = await response.json();
        
        // Clear input
        commentInput.value = '';
        
        // Update comment count
        commentCount.textContent = data.commentCount;
        
        // Add new comment to the list
        addCommentToUI(commentsList, data.comment);
        
        showToast('Comment added successfully!');
        
    } catch (error) {
        console.error('Error adding comment:', error);
        showToast(error.message || 'Failed to add comment. Please try again.', 'error');
    } finally {
        // Restore input
        commentInput.disabled = false;
        commentInput.placeholder = originalPlaceholder;
        commentInput.focus();
    }
}

// Handle Enter key press in comment input
function handleCommentKeyPress(event, postId) {
    if (event.key === 'Enter') {
        event.preventDefault();
        addComment(postId);
    }
}

// Add comment to UI
function addCommentToUI(commentsList, comment) {
    const commentElement = document.createElement('div');
    commentElement.className = 'comment';
    commentElement.style.opacity = '0';
    commentElement.style.transform = 'translateY(10px)';
    
    const timeString = new Date(comment.createdAt).toLocaleString();
    const avatarHtml = comment.user && comment.user.profilePicture
        ? `<img src="${comment.user.profilePicture}" alt="${comment.user.username}">`
        : (comment.user && comment.user.username ? comment.user.username.charAt(0).toUpperCase() : '?');
    const userId = comment.user && (comment.user._id || comment.user.id);
    const username = comment.user && comment.user.username ? comment.user.username : 'User';
    
    commentElement.innerHTML = `
        <a href="/profile/${userId}" class="comment-avatar" title="View profile" style="text-decoration:none;color:inherit;">${avatarHtml}</a>
        <div class="comment-content">
            <strong><a href="/profile/${userId}" style="text-decoration:none;color:inherit;"> ${username}</a></strong>
            <p>${escapeHtml(comment.content)}</p>
            <small>${timeString}</small>
        </div>
    `;
    
    // Add to comments list
    commentsList.appendChild(commentElement);
    
    // Animate in
    setTimeout(() => {
        commentElement.style.transition = 'all 0.3s ease';
        commentElement.style.opacity = '1';
        commentElement.style.transform = 'translateY(0)';
    }, 10);
    
    // Scroll to new comment
    setTimeout(() => {
        commentElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

// Delete post functionality
async function deletePost(postId) {
    if (!confirm('Are you sure you want to delete this post? This action cannot be undone.')) {
        return;
    }
    
    const postCard = document.querySelector(`[data-post-id="${postId}"]`);
    
    if (!postCard) {
        console.error('Post card not found:', postId);
        return;
    }
    
    try {
        const response = await fetch(`/api/posts/${postId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to delete post');
        }
        
        // Animate out and remove
        postCard.style.transition = 'all 0.4s ease';
        postCard.style.opacity = '0';
        postCard.style.transform = 'translateY(-20px)';
        
        setTimeout(() => {
            postCard.remove();
            showToast('Post deleted successfully');
        }, 400);
        
    } catch (error) {
        console.error('Error deleting post:', error);
        showToast(error.message || 'Failed to delete post. Please try again.', 'error');
    }
}

// Utility function to escape HTML
function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Show toast notification
function showToast(message, type = 'success') {
    // Remove existing toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#ef4444' : '#10b981'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 300px;
        word-wrap: break-word;
    `;
    
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 10);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, 3000);
}

// Refresh posts feed (if needed)
async function refreshFeed() {
    try {
        const response = await fetch('/api/posts/feed');
        if (response.ok) {
            // Reload the page to get updated content
            window.location.reload();
        }
    } catch (error) {
        console.error('Error refreshing feed:', error);
        showToast('Failed to refresh feed', 'error');
    }
}
